"use strict";

/**
 * votes.ts  —  Vote submission, receipt lookup, and dry-run routes.
 *
 * Mounted at prefix /elections in server.ts.
 *
 * Routes (relative to prefix):
 *   POST /:addr/votes                  → relay ZK proof → castVote on-chain
 *   GET  /:addr/votes/:nullifier       → vote receipt: confirm submission
 *   POST /:addr/verify-proof           → dry-run: validate proof is acceptable
 *                                        without submitting
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { validateRelayRequest, submitRelay } from "../chain/relayer";
import {
  logReceived,
  markSubmitted,
  isNullifierPending,
  currentEpochEntries,
  allEpochRecords,
} from "../audit/pendingLog";
import { readVoteCastLogs } from "../chain/event";
import { buildReceiptPdf } from "../audit/pdfBuilder";
import { badRequest, notFound } from "../lib/errors";
import { validateAddr } from "../lib/validateAddr";
import { toSafeJson } from "../lib/serialize";

// ── Schemas ───────────────────────────────────────────────────────────────────

/**
 * Accepts a field element as either:
 *   - a decimal string  ("1234567890")
 *   - a 0x-prefixed hex string ("0x04a9...")
 * and normalises to a decimal string for on-chain use.
 */
const fieldElement = z
  .string()
  .regex(
    /^(0x[0-9a-fA-F]+|\d+)$/,
    "Must be a decimal or 0x-prefixed hex integer string",
  )
  .transform((s) => BigInt(s).toString(10));

const voteBodySchema = z.object({
  raceId: z.number().int().min(0),
  pubSignals: z.array(fieldElement).length(6),
  proof: z.array(fieldElement).length(24),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function votesRoutes(fastify: FastifyInstance) {
  // ── POST /:addr/votes ──────────────────────────────────────────────────────
  /**
   * Security guards (in order):
   *   1. Body shape validation (Zod)
   *   2. Valid Ethereum address
   *   3. Election address registered in factory
   *   4. Election is OPEN
   *   5. pubSignals[3] election_id matches on-chain
   *   6. pubSignals[4] race_id matches raceId param
   *   7. raceId < racesCount
   *   8. Nullifier not already used on-chain
   *   9. Nullifier not in the in-flight pending log
   *  10. Rate limit (per x-voter-token or client IP)
   *  11. Submit castVote — on-chain PlonkVerifier handles proof validity
   */
  fastify.post<{ Params: { addr: string } }>(
    "/:addr/votes",
    async (
      req: FastifyRequest<{ Params: { addr: string } }>,
      reply,
    ) => {
      const { addr } = req.params;
      validateAddr(addr); // guard 2

      const parse = voteBodySchema.safeParse(req.body);
      if (!parse.success) {
        throw badRequest(
          parse.error.issues.map((i) => i.message).join(", "),
          "INVALID_BODY",
        );
      }

      const { raceId: raceIdNum, pubSignals: rawSignals, proof: rawProof } =
        parse.data;

      const raceId = BigInt(raceIdNum);
      const pubSignals = rawSignals.map((s) => BigInt(s));
      const proof = rawProof.map((s) => BigInt(s));

      // guard 9 — pending-log duplicate check
      const nullifierStr = pubSignals[1].toString();
      if (isNullifierPending(addr, nullifierStr)) {
        throw badRequest(
          "This vote is already pending submission",
          "NULLIFIER_PENDING",
        );
      }

      const voterToken =
        (req.headers["x-voter-token"] as string | undefined) ?? undefined;
      const clientIp =
        (req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          ?.trim() ?? req.socket?.remoteAddress;

      // guards 3–8, 10
      await validateRelayRequest({
        eventAddr: addr,
        raceId,
        pubSignals,
        proof,
        voterToken,
        clientIp,
      });

      // Log before submission (pending accountability)
      const entry = logReceived(addr, pubSignals, proof);

      // guard 11 — submit on-chain
      const txHash = await submitRelay(addr, raceId, pubSignals, proof);
      markSubmitted(entry, txHash);

      reply.status(202).send({ txHash, nullifier: nullifierStr });
    },
  );

  // ── GET /:addr/votes/:nullifier ────────────────────────────────────────────
  /**
   * Vote receipt endpoint.
   *
   * Given a nullifier (pubSignals[1] decimal string), returns the submission
   * status of that vote.  Searches in-memory pending log first (fast), then
   * falls back to querying on-chain VoteCast events (accurate for older votes).
   *
   * Response 200:
   *   {
   *     nullifier: string,
   *     status: "pending" | "submitted" | "confirmed" | "not_found",
   *     txHash?: string,
   *     raceId?: string,
   *     candidateId?: string,
   *     blockNumber?: number,
   *     ts?: number,          // ms since epoch, from pending log
   *   }
   */
  fastify.get<{ Params: { addr: string; nullifier: string } }>(
    "/:addr/votes/:nullifier",
    async (req, reply) => {
      const { addr, nullifier } = req.params;
      validateAddr(addr);

      // 1. Search in-memory pending log
      const current = currentEpochEntries(addr);
      const allEpochs = allEpochRecords(addr);
      const allEntries = [
        ...current,
        ...allEpochs.flatMap((r) => r.entries),
      ];
      const match = allEntries.find((e) => e.nullifier === nullifier);

      if (match) {
        reply.send(
          toSafeJson({
            nullifier,
            status: match.submitted ? "submitted" : "pending",
            txHash: match.txHash,
            raceId: match.raceId,
            ts: match.ts,
          }),
        );
        return;
      }

      // 2. Fallback — scan on-chain VoteCast events
      const logs = await readVoteCastLogs(addr);
      const onChain = logs.find((l) => l.nullifier.toString() === nullifier);

      if (onChain) {
        reply.send(
          toSafeJson({
            nullifier,
            status: "confirmed",
            txHash: onChain.txHash,
            raceId: onChain.raceId.toString(),
            candidateId: onChain.candidateId.toString(),
            blockNumber: onChain.blockNumber,
          }),
        );
        return;
      }

      throw notFound(`No vote found for nullifier ${nullifier}`);
    },
  );

  // ── GET /:addr/votes/:nullifier/receipt.pdf ────────────────────────────────
  /**
   * Voter receipt PDF.
   *
   * Given the voter's nullifier (pubSignals[1]), generates a PDF that:
   *   - Confirms their vote is recorded on the blockchain (with tx hash)
   *   - Shows which candidate they voted for in each race
   *   - Includes the complete final results for those races
   *
   * The nullifier is the voter's anonymous identifier — it does not reveal
   * their identity, only that a registered voter cast that specific vote.
   */
  fastify.get<{ Params: { addr: string; nullifier: string } }>(
    "/:addr/votes/:nullifier/receipt.pdf",
    async (req, reply) => {
      const { addr, nullifier } = req.params;
      validateAddr(addr);
      const buf = await buildReceiptPdf(addr, nullifier);
      reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="comprovante-${nullifier.slice(0, 12)}.pdf"`,
        )
        .send(buf);
    },
  );

  // ── POST /:addr/verify-proof ───────────────────────────────────────────────
  /**
   * Dry-run proof validation.
   *
   * Runs the same off-chain guards as POST /:addr/votes (election state,
   * pubSignals consistency, nullifier check) but does NOT submit the tx
   * and does NOT consume a rate-limit token.
   *
   * Useful for:
   *   - Frontend pre-flight check before submitting
   *   - Debugging circuit / signal mismatches
   *
   * Response 200: { valid: true, message: "Proof is acceptable" }
   * Response 4xx: structured AppError describing which guard failed
   */
  fastify.post<{ Params: { addr: string } }>(
    "/:addr/verify-proof",
    async (
      req: FastifyRequest<{ Params: { addr: string } }>,
      reply,
    ) => {
      const { addr } = req.params;
      validateAddr(addr);

      const parse = voteBodySchema.safeParse(req.body);
      if (!parse.success) {
        throw badRequest(
          parse.error.issues.map((i) => i.message).join(", "),
          "INVALID_BODY",
        );
      }

      const { raceId: raceIdNum, pubSignals: rawSignals, proof: rawProof } =
        parse.data;

      const raceId = BigInt(raceIdNum);
      const pubSignals = rawSignals.map((s) => BigInt(s));
      const proof = rawProof.map((s) => BigInt(s));

      // Run guards 3–8 without rate-limiting (skipRateLimit = true) and
      // without actually submitting.
      await validateRelayRequest({
        eventAddr: addr,
        raceId,
        pubSignals,
        proof,
        skipRateLimit: true,
      });

      reply.send({ valid: true, message: "Proof is acceptable for submission" });
    },
  );
}
