"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildZeresima = buildZeresima;
const crypto_1 = require("crypto");
const event_1 = require("../chain/event");
const serialize_1 = require("../lib/serialize");
const event_2 = require("../chain/event");
const errors_1 = require("../lib/errors");
/**
 * Fetch the multi-race Zerésima from the VotingContract.
 * Only available while the election is in PENDING state.
 * Returns a self-describing JSON document with a sha256 digest.
 */
async function buildZeresima(eventAddr) {
    const c = (0, event_1.getVotingContract)(eventAddr);
    let raw;
    try {
        raw = await c.getZeresimaMultiRace();
    }
    catch (err) {
        const msg = err.message ?? String(err);
        if (msg.includes("ElectionNotPending") || msg.includes("not pending")) {
            throw new errors_1.AppError(409, "Zerésima is only available while the election is PENDING", "NOT_PENDING");
        }
        throw err;
    }
    const body = (0, serialize_1.toSafeJson)({
        type: "ZERESIMA",
        eventAddr,
        electionName: raw.electionName,
        electionId: raw.electionId,
        state: event_2.ElectionState[event_2.ElectionState.PENDING],
        snapshots: raw.snapshots,
        voterCount: raw.voterCount,
        merkleRoot: raw.merkleRoot,
        allZero: raw.allZero,
        blockTimestamp: raw.blockTimestamp,
        blockNumber: raw.blockNumber,
        generatedAtIso: new Date().toISOString(),
    });
    const json = JSON.stringify(body);
    const sha256 = (0, crypto_1.createHash)("sha256").update(json).digest("hex");
    return { ...body, sha256 };
}
//# sourceMappingURL=zeresima.js.map