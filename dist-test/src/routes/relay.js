"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = relayRoutes;
const zod_1 = require("zod");
const relayer_1 = require("../chain/relayer");
const pendingLog_1 = require("../audit/pendingLog");
const errors_1 = require("../lib/errors");
// ── Request schema (Zod) ──────────────────────────────────────────────────────
const bigintStringSchema = zod_1.z
    .string()
    .regex(/^\d+$/, "Must be a non-negative decimal integer string");
const relayBodySchema = zod_1.z.object({
    /** Race identifier (0 for the single-race PoC, 0..racesCount-1 for multi-race). */
    raceId: zod_1.z.number().int().min(0),
    /**
     * 6 public signals in canonical order:
     *   [merkle_root, nullifier_hash, candidate_id, election_id, race_id, pick_index]
     */
    pubSignals: zod_1.z.array(bigintStringSchema).length(6),
    /**
     * 24 PLONK proof field elements as produced by
     * snarkjs.plonk.exportSolidityCallData().
     */
    proof: zod_1.z.array(bigintStringSchema).length(24),
});
// ── Route ─────────────────────────────────────────────────────────────────────
async function relayRoutes(fastify) {
    /**
     * POST /events/:addr/relay
     *
     * Accepts a voter's ZK proof and submits castVote on-chain.
     *
     * Security guards (in order, matching contract's check order):
     *   1. Body validation (Zod)
     *   2. eventAddr is a known VotingEvent
     *   3. Election is OPEN
     *   4. pubSignals[3] (election_id) matches on-chain
     *   5. pubSignals[4] (race_id) matches raceId param
     *   6. raceId < racesCount
     *   7. Nullifier not already used on-chain (pre-check, saves gas)
     *   8. Nullifier not in pending log (avoids duplicate in-flight tx)
     *   9. Rate limit (per x-voter-token or client IP)
     *  10. Submit castVote and await receipt
     *
     * The proof is NOT verified off-chain — on-chain PlonkVerifier handles that.
     * Only the cheap requires are replicated here to avoid wasting gas.
     *
     * Request body:
     *   { raceId: number, pubSignals: string[6], proof: string[24] }
     *
     * Response 200: { txHash: string }
     * Response 400: { error, code }
     * Response 409: { error: "Nullifier already used", code }
     * Response 429: { error: "Rate limit exceeded" }
     */
    fastify.post("/events/:addr/relay", async (req, reply) => {
        const { addr } = req.params;
        // 1. Validate body
        const parseResult = relayBodySchema.safeParse(req.body);
        if (!parseResult.success) {
            throw (0, errors_1.badRequest)(`Invalid request body: ${parseResult.error.issues.map((i) => i.message).join(", ")}`, "INVALID_BODY");
        }
        const body = parseResult.data;
        const raceId = BigInt(body.raceId);
        const pubSignals = body.pubSignals.map((s) => BigInt(s));
        const proof = body.proof.map((s) => BigInt(s));
        // 8. Check pending log (in-flight duplicate)
        const nullifierStr = pubSignals[1].toString();
        if ((0, pendingLog_1.isNullifierPending)(addr, nullifierStr)) {
            reply.status(409).send({
                error: "This vote is already pending submission",
                code: "NULLIFIER_PENDING",
            });
            return;
        }
        // 2–7 + 9. Run relay guards
        const voterToken = req.headers["x-voter-token"];
        const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
            req.socket?.remoteAddress;
        await (0, relayer_1.validateRelayRequest)({
            eventAddr: addr,
            raceId,
            pubSignals,
            proof,
            voterToken,
            clientIp,
        });
        // Log the proof as received (before submission)
        const entry = (0, pendingLog_1.logReceived)(addr, pubSignals, proof);
        // 10. Submit
        const txHash = await (0, relayer_1.submitRelay)(addr, raceId, pubSignals, proof);
        (0, pendingLog_1.markSubmitted)(entry, txHash);
        reply.status(200).send({ txHash });
    });
}
//# sourceMappingURL=relay.js.map