"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._getPoseidonForTests = exports.TREE_SIZE = exports.TREE_DEPTH = void 0;
exports.buildTree = buildTree;
exports.computeLeafCommitment = computeLeafCommitment;
exports.computeNullifier = computeNullifier;
const poseidon_1 = require("../lib/poseidon");
Object.defineProperty(exports, "_getPoseidonForTests", { enumerable: true, get: function () { return poseidon_1.getPoseidon; } });
exports.TREE_DEPTH = 4; // matches voter_proof.circom depth=4
exports.TREE_SIZE = 1 << exports.TREE_DEPTH; // 16 leaves
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
async function buildTree(commitments) {
    const poseidon = await (0, poseidon_1.getPoseidon)();
    const F = poseidon.F;
    // ── Build leaf layer ───────────────────────────────────────────────────────
    const rawLeaves = new Array(exports.TREE_SIZE).fill(null).map(() => F.zero);
    for (const { commitment, leafIndex } of commitments) {
        if (leafIndex < 0 || leafIndex >= exports.TREE_SIZE) {
            throw new Error(`leafIndex ${leafIndex} is out of range [0, ${exports.TREE_SIZE - 1}]`);
        }
        rawLeaves[leafIndex] = poseidon.F.e(commitment);
    }
    // ── Build tree (level 0 = leaves, level TREE_DEPTH = root) ────────────────
    const levels = [rawLeaves];
    for (let d = 0; d < exports.TREE_DEPTH; d++) {
        const prev = levels[d];
        const next = [];
        for (let i = 0; i < prev.length; i += 2) {
            next.push(poseidon([prev[i], prev[i + 1]]));
        }
        levels.push(next);
    }
    const root = (0, poseidon_1.fieldToStr)(poseidon, levels[exports.TREE_DEPTH][0]);
    const leaves = rawLeaves.map((l) => (0, poseidon_1.fieldToStr)(poseidon, l));
    function inclusionProof(leafIndex) {
        const pathElements = [];
        const pathIndices = [];
        let cur = leafIndex;
        for (let d = 0; d < exports.TREE_DEPTH; d++) {
            const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
            pathElements.push((0, poseidon_1.fieldToStr)(poseidon, levels[d][sib]));
            pathIndices.push(cur % 2);
            cur = Math.floor(cur / 2);
        }
        return { pathElements, pathIndices, root };
    }
    function indexOf(commitment) {
        return leaves.indexOf(commitment);
    }
    return { root, leaves, inclusionProof, indexOf };
}
/** Compute Poseidon(voter_id) — the leaf commitment for a voter. */
async function computeLeafCommitment(voterId) {
    const poseidon = await (0, poseidon_1.getPoseidon)();
    return (0, poseidon_1.fieldToStr)(poseidon, poseidon([voterId]));
}
/**
 * Compute the canonical nullifier hash:
 *   Poseidon(voter_id, election_id, race_id, pick_index)
 *
 * For off-circuit validation only (e.g. test fixtures).
 * Backend never calls this for live requests — it trusts the voter's proof.
 */
async function computeNullifier(voterId, electionId, raceId, pickIndex = 0n) {
    const poseidon = await (0, poseidon_1.getPoseidon)();
    return (0, poseidon_1.fieldToStr)(poseidon, poseidon([voterId, electionId, raceId, pickIndex]));
}
//# sourceMappingURL=builder.js.map