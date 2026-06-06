#!/usr/bin/env node
/**
 * proof_input.js
 *
 * Utility functions for building circom witness inputs + a CLI demo.
 *
 * Usage (interactive):
 *   node scripts/proof_input.js
 *
 * Usage (pipe to snarkjs):
 *   node scripts/proof_input.js --voter-id 12345678901 --election-id 1 \
 *     --race-id 1 --candidate-id 42 --pick-index 0 \
 *     | snarkjs plonk prove ../pi-votacao-zk-circuits/artifacts/voter_proof.zkey \
 *       /dev/stdin proof.json public.json
 *
 * Functions exported (for use in other scripts):
 *   computeCommitment(poseidon, F, voterId)
 *   computeNullifier(poseidon, F, voterId, electionId, raceId, pickIndex)
 *   buildVoterTree(poseidon, F, voterIds)
 *   buildCircuitInput(poseidon, F, tree, voterIds, opts)
 */

"use strict";

const { buildPoseidon } = require("circomlibjs");

// ── Tree config (must match voter_proof.circom depth parameter) ───────────────
const TREE_DEPTH = 4;
const TREE_SIZE = 1 << TREE_DEPTH; // 16 leaves

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Compute leaf commitment for a voter.
 *   commitment = Poseidon(voter_id)
 *
 * This is what gets stored on-chain when a voter is enrolled.
 *
 * @param {object} poseidon - circomlibjs poseidon function
 * @param {object} F - poseidon.F field
 * @param {bigint} voterId - the voter's secret identifier (e.g. CPF as BigInt)
 * @returns {string} decimal string of the commitment
 */
function computeCommitment(poseidon, F, voterId) {
  return F.toString(poseidon([voterId]));
}

/**
 * Compute the nullifier for a specific vote.
 *   nullifier = Poseidon(voter_id, election_id, race_id, pick_index)
 *
 * The nullifier is what prevents double voting — it's unique per
 * (voter, election, race, pick). The backend stores it on-chain.
 *
 * @param {object} poseidon
 * @param {object} F
 * @param {bigint} voterId
 * @param {bigint} electionId  - from GET /elections/:addr → currentElectionId
 * @param {bigint} raceId
 * @param {bigint} pickIndex   - 0 for single-pick races
 * @returns {string} decimal string
 */
function computeNullifier(poseidon, F, voterId, electionId, raceId, pickIndex = 0n) {
  return F.toString(poseidon([voterId, electionId, raceId, pickIndex]));
}

/**
 * Build a depth-4 Poseidon Merkle tree from a list of voter IDs.
 *
 * Leaf[i] = Poseidon(voterIds[i])
 * Empty slots are filled with F.zero.
 *
 * The root must match voterMerkleRoot on the VotingContract after
 * all voters are enrolled.
 *
 * @param {object} poseidon
 * @param {object} F
 * @param {bigint[]} voterIds - ordered list (index = leafIndex on-chain)
 * @returns {{ tree: Uint8Array[][], root: string, leaves: string[] }}
 */
function buildVoterTree(poseidon, F, voterIds) {
  if (voterIds.length > TREE_SIZE) {
    throw new Error(`Too many voters: max ${TREE_SIZE}, got ${voterIds.length}`);
  }

  // Build leaf layer
  const rawLeaves = new Array(TREE_SIZE).fill(null).map(() => F.zero);
  for (let i = 0; i < voterIds.length; i++) {
    rawLeaves[i] = poseidon([voterIds[i]]);
  }

  // Build tree bottom-up
  const levels = [rawLeaves];
  for (let d = 0; d < TREE_DEPTH; d++) {
    const prev = levels[d];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(poseidon([prev[i], prev[i + 1]]));
    }
    levels.push(next);
  }

  const root = F.toString(levels[TREE_DEPTH][0]);
  const leaves = rawLeaves.map((l) => F.toString(l));

  return { levels, root, leaves };
}

/**
 * Generate the Merkle inclusion proof for the voter at leafIndex.
 *
 * @param {object} poseidon
 * @param {object} F
 * @param {{ levels: Uint8Array[][] }} tree - from buildVoterTree
 * @param {number} leafIndex
 * @returns {{ pathElements: string[], pathIndices: number[], root: string }}
 */
function buildInclusionProof(poseidon, F, tree, leafIndex) {
  const { levels } = tree;
  const pathElements = [];
  const pathIndices = [];
  let cur = leafIndex;

  for (let d = 0; d < TREE_DEPTH; d++) {
    const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
    pathElements.push(F.toString(levels[d][sib]));
    pathIndices.push(cur % 2);
    cur = Math.floor(cur / 2);
  }

  return { pathElements, pathIndices };
}

/**
 * Assemble the full circom witness input object, ready to pass to snarkjs.
 *
 * @param {object} poseidon
 * @param {object} F
 * @param {{ levels, root, leaves }} tree - from buildVoterTree
 * @param {bigint[]} voterIds - same list used to build the tree
 * @param {object} opts
 * @param {bigint}  opts.voterId      - must be in voterIds
 * @param {bigint}  opts.electionId   - from GET /elections/:addr → currentElectionId
 * @param {bigint}  opts.raceId       - race being voted on
 * @param {bigint}  opts.candidateId  - candidate being voted for
 * @param {bigint}  [opts.pickIndex]  - default 0n
 * @returns {object} input JSON for snarkjs plonk prove / witness compute
 */
function buildCircuitInput(poseidon, F, tree, voterIds, opts) {
  const { voterId, electionId, raceId, candidateId, pickIndex = 0n } = opts;

  const leafIndex = voterIds.indexOf(voterId);
  if (leafIndex === -1) throw new Error(`voterId ${voterId} not found in voter list`);

  const { pathElements, pathIndices } = buildInclusionProof(poseidon, F, tree, leafIndex);
  const nullifier = computeNullifier(poseidon, F, voterId, electionId, raceId, pickIndex);

  return {
    voter_id: voterId.toString(),
    merkle_root: tree.root,
    merkle_path: pathElements,
    merkle_path_indices: pathIndices,
    nullifier_hash: nullifier,
    candidate_id: candidateId.toString(),
    election_id: electionId.toString(),
    race_id: raceId.toString(),
    pick_index: pickIndex.toString(),
  };
}

module.exports = {
  computeCommitment,
  computeNullifier,
  buildVoterTree,
  buildInclusionProof,
  buildCircuitInput,
  TREE_DEPTH,
  TREE_SIZE,
};

// ── CLI demo ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const get = (flag, def) => {
      const i = args.indexOf(flag);
      return i !== -1 ? args[i + 1] : def;
    };

    // Example voter list — in production, read from GET /elections/:addr/voters
    const EXAMPLE_VOTER_IDS = [
      12345678901n, 98765432100n, 11122233344n, 55566677788n,
      99900011122n, 33344455566n, 77788899900n, 22233344455n,
    ];

    const voterId     = BigInt(get("--voter-id",     "12345678901"));
    const electionId  = BigInt(get("--election-id",  "1"));
    const raceId      = BigInt(get("--race-id",      "1"));
    const candidateId = BigInt(get("--candidate-id", "42"));
    const pickIndex   = BigInt(get("--pick-index",   "0"));

    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // 1. Build tree from voter list
    const tree = buildVoterTree(poseidon, F, EXAMPLE_VOTER_IDS);

    // 2. Show debug info on stderr (so stdout stays clean JSON)
    const commitment = computeCommitment(poseidon, F, voterId);
    const nullifier  = computeNullifier(poseidon, F, voterId, electionId, raceId, pickIndex);
    const leafIndex  = EXAMPLE_VOTER_IDS.indexOf(voterId);

    process.stderr.write(`\n--- Voter Info ---\n`);
    process.stderr.write(`voter_id:    ${voterId}\n`);
    process.stderr.write(`leaf_index:  ${leafIndex}\n`);
    process.stderr.write(`commitment:  ${commitment}\n`);
    process.stderr.write(`nullifier:   ${nullifier}\n`);
    process.stderr.write(`merkle_root: ${tree.root}\n`);
    process.stderr.write(`\n--- Circuit Input (stdout) ---\n`);

    // 3. Build full circuit input
    const input = buildCircuitInput(poseidon, F, tree, EXAMPLE_VOTER_IDS, {
      voterId, electionId, raceId, candidateId, pickIndex,
    });

    // 4. Print JSON to stdout (pipeable to snarkjs)
    process.stdout.write(JSON.stringify(input, null, 2) + "\n");
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
