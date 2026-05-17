"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const pendingLog_1 = require("../../src/audit/pendingLog");
const ADDR_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADDR_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
function makePubSignals(nullifier, raceId = BigInt(0)) {
    return [
        BigInt(1234), // merkle_root
        nullifier, // nullifier_hash
        BigInt(1), // candidate_id
        BigInt(99), // election_id
        raceId, // race_id
        BigInt(0), // pick_index
    ];
}
const dummyProof = Array.from({ length: 24 }, (_, i) => BigInt(i + 1));
describe("pendingLog", () => {
    beforeEach(() => (0, pendingLog_1._resetPendingLogForTests)());
    it("logReceived adds entry to current epoch", () => {
        const ps = makePubSignals(BigInt(42));
        (0, pendingLog_1.logReceived)(ADDR_A, ps, dummyProof);
        const entries = (0, pendingLog_1.currentEpochEntries)(ADDR_A);
        (0, chai_1.expect)(entries).to.have.length(1);
        (0, chai_1.expect)(entries[0].nullifier).to.equal("42");
        (0, chai_1.expect)(entries[0].submitted).to.be.false;
    });
    it("filters entries by event address", () => {
        (0, pendingLog_1.logReceived)(ADDR_A, makePubSignals(BigInt(1)), dummyProof);
        (0, pendingLog_1.logReceived)(ADDR_B, makePubSignals(BigInt(2)), dummyProof);
        (0, chai_1.expect)((0, pendingLog_1.currentEpochEntries)(ADDR_A)).to.have.length(1);
        (0, chai_1.expect)((0, pendingLog_1.currentEpochEntries)(ADDR_B)).to.have.length(1);
    });
    it("isNullifierPending returns true for pending entry", () => {
        const ps = makePubSignals(BigInt(77));
        (0, pendingLog_1.logReceived)(ADDR_A, ps, dummyProof);
        (0, chai_1.expect)((0, pendingLog_1.isNullifierPending)(ADDR_A, "77")).to.be.true;
    });
    it("isNullifierPending returns false for unknown nullifier", () => {
        (0, chai_1.expect)((0, pendingLog_1.isNullifierPending)(ADDR_A, "9999")).to.be.false;
    });
    it("isNullifierPending returns false once markSubmitted is called", () => {
        const ps = makePubSignals(BigInt(55));
        const entry = (0, pendingLog_1.logReceived)(ADDR_A, ps, dummyProof);
        (0, pendingLog_1.markSubmitted)(entry, "0xdeadbeef");
        (0, chai_1.expect)((0, pendingLog_1.isNullifierPending)(ADDR_A, "55")).to.be.false;
        (0, chai_1.expect)(entry.submitted).to.be.true;
        (0, chai_1.expect)(entry.txHash).to.equal("0xdeadbeef");
    });
    it("currentEpochEntries returns all entries when no address filter", () => {
        (0, pendingLog_1.logReceived)(ADDR_A, makePubSignals(BigInt(1)), dummyProof);
        (0, pendingLog_1.logReceived)(ADDR_B, makePubSignals(BigInt(2)), dummyProof);
        (0, chai_1.expect)((0, pendingLog_1.currentEpochEntries)()).to.have.length(2);
    });
});
//# sourceMappingURL=pendingLog.test.js.map