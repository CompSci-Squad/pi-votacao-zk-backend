"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBoletimUrna = buildBoletimUrna;
const crypto_1 = require("crypto");
const event_1 = require("../chain/event");
const serialize_1 = require("../lib/serialize");
const STATE_LABELS = ["PENDING", "OPEN", "FINISHED"];
/**
 * Fetch and return the Boletim de Urna (vote tally) document.
 * Available in any election state; semantically meant to be called
 * after closeElection(), but returning live partial results during
 * OPEN is valid and useful for observers.
 */
async function buildBoletimUrna(eventAddr) {
    const bu = await (0, event_1.readBoletimUrna)(eventAddr);
    const body = (0, serialize_1.toSafeJson)({
        type: "BOLETIM_DE_URNA",
        eventAddr,
        electionName: bu.electionName,
        electionId: bu.electionId,
        state: STATE_LABELS[bu.state] ?? String(bu.state),
        snapshots: bu.snapshots,
        voterCount: bu.voterCount,
        merkleRoot: bu.merkleRoot,
        grandTotalVotes: bu.grandTotalVotes,
        blockTimestamp: bu.blockTimestamp,
        blockNumber: bu.blockNumber,
        generatedAtIso: new Date().toISOString(),
    });
    const json = JSON.stringify(body);
    const sha256 = (0, crypto_1.createHash)("sha256").update(json).digest("hex");
    return { ...body, sha256 };
}
//# sourceMappingURL=bu.js.map