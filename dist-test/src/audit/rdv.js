"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRdv = buildRdv;
const crypto_1 = require("crypto");
const event_1 = require("../chain/event");
const serialize_1 = require("../lib/serialize");
/**
 * Build the Registro Digital de Voto (RDV) — a log of every cast vote,
 * sourced from on-chain VoteCast events.
 *
 * Each entry contains the nullifier (anonymous voter token), race, and
 * candidate. No voter identity is exposed. The document is byte-identical
 * to any re-computation from the same chain state (deterministic).
 */
async function buildRdv(eventAddr) {
    const logs = await (0, event_1.readVoteCastLogs)(eventAddr);
    const votes = logs.map((log) => ({
        nullifier: log.nullifier.toString(),
        raceId: log.raceId.toString(),
        candidateId: log.candidateId.toString(),
        pickIndex: log.pickIndex,
        txHash: log.txHash,
        blockNumber: log.blockNumber,
    }));
    const body = (0, serialize_1.toSafeJson)({
        type: "RDV",
        eventAddr,
        voteCount: votes.length,
        votes,
        generatedAtIso: new Date().toISOString(),
    });
    const json = JSON.stringify(body);
    const sha256 = (0, crypto_1.createHash)("sha256").update(json).digest("hex");
    return { ...body, sha256 };
}
//# sourceMappingURL=rdv.js.map