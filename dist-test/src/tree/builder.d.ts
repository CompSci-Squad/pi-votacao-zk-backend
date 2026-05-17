import { getPoseidon } from "../lib/poseidon";
export declare const TREE_DEPTH = 4;
export declare const TREE_SIZE: number;
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
export declare function buildTree(commitments: {
    commitment: bigint;
    leafIndex: number;
}[]): Promise<PoseidonTree>;
/** Compute Poseidon(voter_id) — the leaf commitment for a voter. */
export declare function computeLeafCommitment(voterId: bigint): Promise<string>;
/**
 * Compute the canonical nullifier hash:
 *   Poseidon(voter_id, election_id, race_id, pick_index)
 *
 * For off-circuit validation only (e.g. test fixtures).
 * Backend never calls this for live requests — it trusts the voter's proof.
 */
export declare function computeNullifier(voterId: bigint, electionId: bigint, raceId: bigint, pickIndex?: bigint): Promise<string>;
export { getPoseidon as _getPoseidonForTests };
//# sourceMappingURL=builder.d.ts.map