"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const builder_1 = require("../../src/tree/builder");
const poseidon_1 = require("../../src/lib/poseidon");
describe("Merkle tree builder", function () {
    this.timeout(20_000); // Poseidon wasm init can be slow in CI
    afterEach(() => (0, poseidon_1._resetPoseidonForTests)());
    it("builds an empty tree with a deterministic zero root", async () => {
        const tree = await (0, builder_1.buildTree)([]);
        (0, chai_1.expect)(tree.root).to.be.a("string").and.match(/^\d+$/);
        (0, chai_1.expect)(tree.leaves).to.have.length(1 << builder_1.TREE_DEPTH);
    });
    it("indexOf returns -1 for unknown commitment", async () => {
        const tree = await (0, builder_1.buildTree)([]);
        (0, chai_1.expect)(tree.indexOf("99999999")).to.equal(-1);
    });
    it("indexOf returns correct leafIndex for a known voter", async () => {
        const voterId = BigInt("42");
        const commitment = await (0, builder_1.computeLeafCommitment)(voterId);
        const tree = await (0, builder_1.buildTree)([{ commitment: BigInt(commitment), leafIndex: 0 }]);
        (0, chai_1.expect)(tree.indexOf(commitment)).to.equal(0);
    });
    it("inclusion proof validates back to root", async () => {
        // Build a tree with 3 voters at known indices
        const ids = [BigInt(1), BigInt(2), BigInt(3)];
        const commitments = await Promise.all(ids.map(async (id, i) => {
            const c = await (0, builder_1.computeLeafCommitment)(id);
            return { commitment: BigInt(c), commitmentStr: c, leafIndex: i };
        }));
        const tree = await (0, builder_1.buildTree)(commitments.map(({ commitment, leafIndex }) => ({ commitment, leafIndex })));
        for (const { commitmentStr, leafIndex } of commitments) {
            (0, chai_1.expect)(tree.indexOf(commitmentStr)).to.equal(leafIndex);
            const proof = tree.inclusionProof(leafIndex);
            (0, chai_1.expect)(proof.root).to.equal(tree.root);
            (0, chai_1.expect)(proof.pathElements).to.have.length(builder_1.TREE_DEPTH);
            (0, chai_1.expect)(proof.pathIndices).to.have.length(builder_1.TREE_DEPTH);
        }
    });
    it("changing a leaf changes the root", async () => {
        const c1 = await (0, builder_1.computeLeafCommitment)(BigInt(1));
        const c2 = await (0, builder_1.computeLeafCommitment)(BigInt(2));
        const tree1 = await (0, builder_1.buildTree)([{ commitment: BigInt(c1), leafIndex: 0 }]);
        const tree2 = await (0, builder_1.buildTree)([{ commitment: BigInt(c2), leafIndex: 0 }]);
        (0, chai_1.expect)(tree1.root).to.not.equal(tree2.root);
    });
    it("computeNullifier returns deterministic decimal string", async () => {
        const a = await (0, builder_1.computeNullifier)(BigInt(1), BigInt(100), BigInt(0), BigInt(0));
        const b = await (0, builder_1.computeNullifier)(BigInt(1), BigInt(100), BigInt(0), BigInt(0));
        (0, chai_1.expect)(a).to.equal(b);
        (0, chai_1.expect)(a).to.match(/^\d+$/);
    });
    it("computeNullifier differs when any input differs", async () => {
        const base = await (0, builder_1.computeNullifier)(BigInt(1), BigInt(100), BigInt(0), BigInt(0));
        const diffVoter = await (0, builder_1.computeNullifier)(BigInt(2), BigInt(100), BigInt(0), BigInt(0));
        const diffElec = await (0, builder_1.computeNullifier)(BigInt(1), BigInt(200), BigInt(0), BigInt(0));
        const diffRace = await (0, builder_1.computeNullifier)(BigInt(1), BigInt(100), BigInt(1), BigInt(0));
        (0, chai_1.expect)(base).to.not.equal(diffVoter);
        (0, chai_1.expect)(base).to.not.equal(diffElec);
        (0, chai_1.expect)(base).to.not.equal(diffRace);
    });
});
//# sourceMappingURL=tree.test.js.map