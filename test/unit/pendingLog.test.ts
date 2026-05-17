"use strict";

import { expect } from "chai";
import {
  logReceived,
  markSubmitted,
  isNullifierPending,
  currentEpochEntries,
  _resetPendingLogForTests,
} from "../../src/audit/pendingLog";

const ADDR_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADDR_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function makePubSignals(nullifier: bigint, raceId = BigInt(0)): bigint[] {
  return [
    BigInt(1234), // merkle_root
    nullifier,    // nullifier_hash
    BigInt(1),    // candidate_id
    BigInt(99),   // election_id
    raceId,       // race_id
    BigInt(0),    // pick_index
  ];
}

const dummyProof = Array.from({ length: 24 }, (_, i) => BigInt(i + 1));

describe("pendingLog", () => {
  beforeEach(() => _resetPendingLogForTests());

  it("logReceived adds entry to current epoch", () => {
    const ps = makePubSignals(BigInt(42));
    logReceived(ADDR_A, ps, dummyProof);
    const entries = currentEpochEntries(ADDR_A);
    expect(entries).to.have.length(1);
    expect(entries[0].nullifier).to.equal("42");
    expect(entries[0].submitted).to.be.false;
  });

  it("filters entries by event address", () => {
    logReceived(ADDR_A, makePubSignals(BigInt(1)), dummyProof);
    logReceived(ADDR_B, makePubSignals(BigInt(2)), dummyProof);
    expect(currentEpochEntries(ADDR_A)).to.have.length(1);
    expect(currentEpochEntries(ADDR_B)).to.have.length(1);
  });

  it("isNullifierPending returns true for pending entry", () => {
    const ps = makePubSignals(BigInt(77));
    logReceived(ADDR_A, ps, dummyProof);
    expect(isNullifierPending(ADDR_A, "77")).to.be.true;
  });

  it("isNullifierPending returns false for unknown nullifier", () => {
    expect(isNullifierPending(ADDR_A, "9999")).to.be.false;
  });

  it("isNullifierPending returns false once markSubmitted is called", () => {
    const ps = makePubSignals(BigInt(55));
    const entry = logReceived(ADDR_A, ps, dummyProof);
    markSubmitted(entry, "0xdeadbeef");
    expect(isNullifierPending(ADDR_A, "55")).to.be.false;
    expect(entry.submitted).to.be.true;
    expect(entry.txHash).to.equal("0xdeadbeef");
  });

  it("currentEpochEntries returns all entries when no address filter", () => {
    logReceived(ADDR_A, makePubSignals(BigInt(1)), dummyProof);
    logReceived(ADDR_B, makePubSignals(BigInt(2)), dummyProof);
    expect(currentEpochEntries()).to.have.length(2);
  });
});
