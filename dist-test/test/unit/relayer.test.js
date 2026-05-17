"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const errors_1 = require("../../src/lib/errors");
const relayer_1 = require("../../src/chain/relayer");
const event_1 = require("../../src/chain/event");
// ── Fixtures ──────────────────────────────────────────────────────────────────
const EVENT_ADDR = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ELECTION_ID = BigInt(1);
const RACE_ID = BigInt(0);
const RACES_COUNT = BigInt(1);
const NULLIFIER = BigInt(9999);
const MERKLE_ROOT = BigInt(12345);
/** Valid pubSignals: [merkle_root, nullifier, candidate_id, election_id, race_id, pick_index] */
function makePubSignals(overrides = {}) {
    return [
        overrides.merkleRoot ?? MERKLE_ROOT,
        overrides.nullifier ?? NULLIFIER,
        BigInt(1),
        overrides.electionId ?? ELECTION_ID,
        overrides.raceId ?? RACE_ID,
        BigInt(0),
    ];
}
function makeDeps(overrides = {}) {
    return {
        isKnownEvent: async (_addr) => true,
        getElectionId: async (_addr) => ELECTION_ID,
        getElectionState: async (_addr) => event_1.ElectionState.OPEN,
        getRacesCount: async (_addr) => RACES_COUNT,
        checkNullifierUsed: async (_addr, _raceId, _nullifier) => false,
        ...overrides,
    };
}
// ── Tests ─────────────────────────────────────────────────────────────────────
describe("validateRelayRequest guards", () => {
    it("passes all guards for a valid request", async () => {
        const deps = makeDeps();
        // Should not throw
        await (0, relayer_1.validateRelayRequest)({ eventAddr: EVENT_ADDR, raceId: RACE_ID, pubSignals: makePubSignals(), proof: [], voterToken: undefined, clientIp: "127.0.0.1" }, deps);
    });
    it("rejects unknown event (guard 1)", async () => {
        const deps = makeDeps({ isKnownEvent: async () => false });
        try {
            await (0, relayer_1.validateRelayRequest)({ eventAddr: EVENT_ADDR, raceId: RACE_ID, pubSignals: makePubSignals(), proof: [], voterToken: undefined, clientIp: "1.2.3.4" }, deps);
            chai_1.expect.fail("should have thrown");
        }
        catch (e) {
            (0, chai_1.expect)(e).to.be.instanceOf(errors_1.AppError);
            (0, chai_1.expect)(e.code).to.equal("UNKNOWN_EVENT");
            (0, chai_1.expect)(e.statusCode).to.equal(400);
        }
    });
    it("rejects election not in OPEN state (guard 2)", async () => {
        const deps = makeDeps({
            getElectionState: async () => event_1.ElectionState.PENDING,
        });
        try {
            await (0, relayer_1.validateRelayRequest)({ eventAddr: EVENT_ADDR, raceId: RACE_ID, pubSignals: makePubSignals(), proof: [], voterToken: undefined, clientIp: "1.2.3.4" }, deps);
            chai_1.expect.fail("should have thrown");
        }
        catch (e) {
            (0, chai_1.expect)(e.code).to.equal("ELECTION_NOT_OPEN");
        }
    });
    it("rejects wrong election_id in pubSignals[3] (guard 3)", async () => {
        const deps = makeDeps();
        try {
            await (0, relayer_1.validateRelayRequest)({
                eventAddr: EVENT_ADDR,
                raceId: RACE_ID,
                pubSignals: makePubSignals({ electionId: BigInt(9999) }), // mismatch
                proof: [],
                voterToken: undefined,
                clientIp: "1.2.3.4",
            }, deps);
            chai_1.expect.fail("should have thrown");
        }
        catch (e) {
            (0, chai_1.expect)(e.code).to.equal("INVALID_ELECTION_ID");
        }
    });
    it("rejects raceId param vs pubSignals[4] mismatch (guard 4)", async () => {
        const deps = makeDeps();
        try {
            await (0, relayer_1.validateRelayRequest)({
                eventAddr: EVENT_ADDR,
                raceId: BigInt(1), // param says race 1
                pubSignals: makePubSignals({ raceId: BigInt(0) }), // signal says race 0
                proof: [],
                voterToken: undefined,
                clientIp: "1.2.3.4",
            }, deps);
            chai_1.expect.fail("should have thrown");
        }
        catch (e) {
            (0, chai_1.expect)(e.code).to.equal("RACE_ID_MISMATCH");
        }
    });
    it("rejects raceId >= racesCount (guard 5)", async () => {
        const deps = makeDeps({
            getRacesCount: async () => BigInt(1), // only race 0 exists
        });
        const raceId = BigInt(1);
        try {
            await (0, relayer_1.validateRelayRequest)({
                eventAddr: EVENT_ADDR,
                raceId,
                pubSignals: makePubSignals({ raceId }),
                proof: [],
                voterToken: undefined,
                clientIp: "1.2.3.4",
            }, deps);
            chai_1.expect.fail("should have thrown");
        }
        catch (e) {
            (0, chai_1.expect)(e.code).to.equal("INVALID_RACE_ID");
        }
    });
    it("rejects nullifier already used on-chain (guard 6 → 409)", async () => {
        const deps = makeDeps({ checkNullifierUsed: async () => true });
        try {
            await (0, relayer_1.validateRelayRequest)({ eventAddr: EVENT_ADDR, raceId: RACE_ID, pubSignals: makePubSignals(), proof: [], voterToken: undefined, clientIp: "1.2.3.4" }, deps);
            chai_1.expect.fail("should have thrown");
        }
        catch (e) {
            (0, chai_1.expect)(e.code).to.equal("NULLIFIER_USED");
            (0, chai_1.expect)(e.statusCode).to.equal(409);
        }
    });
    it("rejects when rate limit throws (guard 7)", async function () {
        // The rate limiter is module-level (not injectable); we exhaust it by
        // calling validateRelayRequest enough times with the same voterToken.
        // Default: 10 requests / 60s window (configurable via RATE_LIMIT_COUNT).
        // We call 11 times with the same token to trigger the 429.
        const deps = makeDeps();
        const params = {
            eventAddr: EVENT_ADDR,
            raceId: RACE_ID,
            pubSignals: makePubSignals(),
            proof: [],
            voterToken: "test-exhaustion-token",
            clientIp: "1.2.3.4",
        };
        let threwRateLimit = false;
        for (let i = 0; i < 12; i++) {
            try {
                // Use a fresh nullifier each time so we don't hit NULLIFIER_USED
                const ps = makePubSignals({ nullifier: BigInt(i + 10_000) });
                await (0, relayer_1.validateRelayRequest)({ ...params, pubSignals: ps }, deps);
            }
            catch (e) {
                if (e instanceof errors_1.AppError && e.statusCode === 429) {
                    threwRateLimit = true;
                    break;
                }
            }
        }
        (0, chai_1.expect)(threwRateLimit).to.be.true;
    });
});
//# sourceMappingURL=relayer.test.js.map