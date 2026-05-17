"use strict";

import { expect } from "chai";
import {
  buildTree,
  computeLeafCommitment,
  computeNullifier,
  TREE_DEPTH,
} from "../../src/tree/builder";
import { _resetPoseidonForTests } from "../../src/lib/poseidon";

describe("Merkle tree builder", function () {
  this.timeout(20_000); // Poseidon wasm init can be slow in CI

  afterEach(() => _resetPoseidonForTests());

  it("builds an empty tree with a deterministic zero root", async () => {
    const tree = await buildTree([]);
    expect(tree.root).to.be.a("string").and.match(/^\d+$/);
    expect(tree.leaves).to.have.length(1 << TREE_DEPTH);
  });

  it("indexOf returns -1 for unknown commitment", async () => {
    const tree = await buildTree([]);
    expect(tree.indexOf("99999999")).to.equal(-1);
  });

  it("indexOf returns correct leafIndex for a known voter", async () => {
    const voterId = BigInt("42");
    const commitment = await computeLeafCommitment(voterId);
    const tree = await buildTree([{ commitment: BigInt(commitment), leafIndex: 0 }]);
    expect(tree.indexOf(commitment)).to.equal(0);
  });

  it("inclusion proof validates back to root", async () => {
    // Build a tree with 3 voters at known indices
    const ids = [BigInt(1), BigInt(2), BigInt(3)];
    const commitments = await Promise.all(
      ids.map(async (id, i) => {
        const c = await computeLeafCommitment(id);
        return { commitment: BigInt(c), commitmentStr: c, leafIndex: i };
      }),
    );
    const tree = await buildTree(commitments.map(({ commitment, leafIndex }) => ({ commitment, leafIndex })));

    for (const { commitmentStr, leafIndex } of commitments) {
      expect(tree.indexOf(commitmentStr)).to.equal(leafIndex);
      const proof = tree.inclusionProof(leafIndex);
      expect(proof.root).to.equal(tree.root);
      expect(proof.pathElements).to.have.length(TREE_DEPTH);
      expect(proof.pathIndices).to.have.length(TREE_DEPTH);
    }
  });

  it("changing a leaf changes the root", async () => {
    const c1 = await computeLeafCommitment(BigInt(1));
    const c2 = await computeLeafCommitment(BigInt(2));
    const tree1 = await buildTree([{ commitment: BigInt(c1), leafIndex: 0 }]);
    const tree2 = await buildTree([{ commitment: BigInt(c2), leafIndex: 0 }]);
    expect(tree1.root).to.not.equal(tree2.root);
  });

  it("computeNullifier returns deterministic decimal string", async () => {
    const a = await computeNullifier(BigInt(1), BigInt(100), BigInt(0), BigInt(0));
    const b = await computeNullifier(BigInt(1), BigInt(100), BigInt(0), BigInt(0));
    expect(a).to.equal(b);
    expect(a).to.match(/^\d+$/);
  });

  it("computeNullifier differs when any input differs", async () => {
    const base = await computeNullifier(BigInt(1), BigInt(100), BigInt(0), BigInt(0));
    const diffVoter = await computeNullifier(BigInt(2), BigInt(100), BigInt(0), BigInt(0));
    const diffElec = await computeNullifier(BigInt(1), BigInt(200), BigInt(0), BigInt(0));
    const diffRace = await computeNullifier(BigInt(1), BigInt(100), BigInt(1), BigInt(0));
    expect(base).to.not.equal(diffVoter);
    expect(base).to.not.equal(diffElec);
    expect(base).to.not.equal(diffRace);
  });
});
