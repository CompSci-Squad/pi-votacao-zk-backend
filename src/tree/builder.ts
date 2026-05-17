"use strict";

import { getPoseidon, fieldToStr } from "../lib/poseidon";
import type { PoseidonFn } from "circomlibjs";

export const TREE_DEPTH = 4; // matches voter_proof.circom depth=4
export const TREE_SIZE = 1 << TREE_DEPTH; // 16 leaves

export interface PoseidonTree {
  /** Merkle root as decimal string. */
  root: string;
  /** All 16 leaf values (decimal strings). Empty slots are F.zero. */
  leaves: string[];
  /**
   * Compute a Merkle inclusion proof for the leaf at leafIndex.
   * Returns the path elements (sibling hashes) and path indices (0=left, 1=right).
   */
  inclusionProof(leafIndex: number): {
    pathElements: string[];
    pathIndices: number[];
    root: string;
  };
  /**
   * Find the leafIndex of a commitment value.
   * Returns -1 if not found.
   */
  indexOf(commitment: string): number;
}

/**
 * Build a Poseidon Merkle tree (depth 4) from a list of (commitment, leafIndex)
 * pairs, exactly as the circuit and the blockchain repo's proof.js do.
 *
 * The `commitments` array comes from on-chain VoterEnrolled events:
 *   { commitment: bigint, leafIndex: number }[]
 *
 * All other leaf positions are filled with F.zero (the field's additive identity).
 *
 * The resulting tree root must match voterMerkleRoot on the VotingContract.
 */
export async function buildTree(
  commitments: { commitment: bigint; leafIndex: number }[],
): Promise<PoseidonTree> {
  const poseidon = await getPoseidon();
  const F = poseidon.F;

  // ── Build leaf layer ───────────────────────────────────────────────────────
  const rawLeaves: Uint8Array[] = new Array(TREE_SIZE).fill(null).map(() => F.zero);
  for (const { commitment, leafIndex } of commitments) {
    if (leafIndex < 0 || leafIndex >= TREE_SIZE) {
      throw new Error(
        `leafIndex ${leafIndex} is out of range [0, ${TREE_SIZE - 1}]`,
      );
    }
    rawLeaves[leafIndex] = poseidon.F.e(commitment);
  }

  // ── Build tree (level 0 = leaves, level TREE_DEPTH = root) ────────────────
  const levels: Uint8Array[][] = [rawLeaves];
  for (let d = 0; d < TREE_DEPTH; d++) {
    const prev = levels[d];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(poseidon([prev[i], prev[i + 1]]));
    }
    levels.push(next);
  }

  const root = fieldToStr(poseidon, levels[TREE_DEPTH][0]);
  const leaves = rawLeaves.map((l) => fieldToStr(poseidon, l));

  function inclusionProof(leafIndex: number) {
    const pathElements: string[] = [];
    const pathIndices: number[] = [];

    let cur = leafIndex;
    for (let d = 0; d < TREE_DEPTH; d++) {
      const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
      pathElements.push(fieldToStr(poseidon, levels[d][sib]));
      pathIndices.push(cur % 2);
      cur = Math.floor(cur / 2);
    }

    return { pathElements, pathIndices, root };
  }

  function indexOf(commitment: string): number {
    return leaves.indexOf(commitment);
  }

  return { root, leaves, inclusionProof, indexOf };
}

/** Compute Poseidon(voter_id) — the leaf commitment for a voter. */
export async function computeLeafCommitment(voterId: bigint): Promise<string> {
  const poseidon = await getPoseidon();
  return fieldToStr(poseidon, poseidon([voterId]));
}

/**
 * Compute the canonical nullifier hash:
 *   Poseidon(voter_id, election_id, race_id, pick_index)
 *
 * For off-circuit validation only (e.g. test fixtures).
 * Backend never calls this for live requests — it trusts the voter's proof.
 */
export async function computeNullifier(
  voterId: bigint,
  electionId: bigint,
  raceId: bigint,
  pickIndex: bigint = 0n,
): Promise<string> {
  const poseidon = await getPoseidon();
  return fieldToStr(
    poseidon,
    poseidon([voterId, electionId, raceId, pickIndex]),
  );
}

// ── Unused export used internally by tests ────────────────────────────────────

export { getPoseidon as _getPoseidonForTests };
