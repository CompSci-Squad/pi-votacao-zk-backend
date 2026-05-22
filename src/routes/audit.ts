"use strict";

/**
 * audit.ts  —  Audit and results routes for an election.
 *
 * Mounted at prefix /elections (and /events for compat) in server.ts.
 *
 * Routes (relative to prefix):
 *   GET /:addr/results                    → Boletim de Urna (all races)
 *   GET /:addr/races/:raceId/results      → per-race tally
 *   GET /:addr/audit/zeresima             → pre-election zero-vote cert (PENDING only)
 *   GET /:addr/audit/bu                   → alias for /results
 *   GET /:addr/audit/rdv                  → Registro Digital de Voto (VoteCast log)
 *   GET /:addr/audit/pending              → in-flight proof accountability log
 */

import type { FastifyInstance } from "fastify";
import { buildBoletimUrna } from "../audit/bu";
import { buildZeresima } from "../audit/zeresima";
import { buildRdv } from "../audit/rdv";
import {
  currentEpochEntries,
  allEpochRecords,
} from "../audit/pendingLog";
import { readBoletimUrna } from "../chain/event";
import { buildBuPdf, buildReceiptPdf } from "../audit/pdfBuilder";
import { toSafeJson } from "../lib/serialize";
import { badRequest, notFound } from "../lib/errors";
import { validateAddr } from "../lib/validateAddr";

export default async function auditRoutes(fastify: FastifyInstance) {
  // ── GET /:addr/results ─────────────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/:addr/results",
    async (req, reply) => {
      validateAddr(req.params.addr);
      const doc = await buildBoletimUrna(req.params.addr);
      reply.send(toSafeJson(doc));
    },
  );

  // ── GET /:addr/races/:raceId/results ───────────────────────────────────────
  /**
   * Per-race tally.  Returns only the snapshot for the requested race so
   * observers can query individual races without fetching the full BU.
   *
   * Response 200:
   *   {
   *     electionName: string,
   *     electionId: string,
   *     state: string,
   *     raceId: string,
   *     raceName: string,
   *     candidates: [{id, name, party, number, voteCount}],
   *     blankVotes: string,
   *     nullVotes: string,
   *     totalVotes: string,
   *     blockTimestamp: string,
   *     blockNumber: string,
   *   }
   */
  fastify.get<{ Params: { addr: string; raceId: string } }>(
    "/:addr/races/:raceId/results",
    async (req, reply) => {
      const { addr, raceId: raceIdStr } = req.params;
      validateAddr(addr);

      const raceIdNum = parseInt(raceIdStr, 10);
      if (!Number.isFinite(raceIdNum) || raceIdNum < 0) {
        throw badRequest(`raceId must be a non-negative integer`, "INVALID_RACE_ID");
      }

      const bu = await readBoletimUrna(addr);

      const snapshot = bu.snapshots.find(
        (s) => Number(s.raceId) === raceIdNum,
      );
      if (!snapshot) {
        throw notFound(`raceId ${raceIdNum} not found in this election`);
      }

      const STATE_LABELS = ["PENDING", "OPEN", "FINISHED"];
      reply.send(
        toSafeJson({
          electionName: bu.electionName,
          electionId: bu.electionId,
          state: STATE_LABELS[bu.state] ?? String(bu.state),
          raceId: snapshot.raceId,
          raceName: snapshot.name,
          candidates: snapshot.candidates,
          blankVotes: snapshot.blankVotes,
          nullVotes: snapshot.nullVotes,
          totalVotes: snapshot.totalVotes,
          blockTimestamp: bu.blockTimestamp,
          blockNumber: bu.blockNumber,
        }),
      );
    },
  );
  // ── GET /:addr/audit/bu.pdf ──────────────────────────────────────────────────────
  /**
   * Official Boletim de Urna (tally) as a PDF.
   * Available in any state; most meaningful after FINISHED.
   */
  fastify.get<{ Params: { addr: string } }>(
    "/:addr/audit/bu.pdf",
    async (req, reply) => {
      validateAddr(req.params.addr);
      const buf = await buildBuPdf(req.params.addr);
      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="boletim-urna-${req.params.addr.slice(0, 10)}.pdf"`)
        .send(buf);
    },
  );
  // ── GET /:addr/audit/zeresima ──────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/:addr/audit/zeresima",
    async (req, reply) => {
      validateAddr(req.params.addr);
      const doc = await buildZeresima(req.params.addr);
      reply.send(toSafeJson(doc));
    },
  );

  // ── GET /:addr/audit/bu (alias) ────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/:addr/audit/bu",
    async (req, reply) => {
      validateAddr(req.params.addr);
      const doc = await buildBoletimUrna(req.params.addr);
      reply.send(toSafeJson(doc));
    },
  );

  // ── GET /:addr/audit/rdv ───────────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/:addr/audit/rdv",
    async (req, reply) => {
      validateAddr(req.params.addr);
      const doc = await buildRdv(req.params.addr);
      reply.send(toSafeJson(doc));
    },
  );

  // ── GET /:addr/audit/pending ───────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/:addr/audit/pending",
    async (req, reply) => {
      const { addr } = req.params;
      validateAddr(addr);
      reply.send({
        currentEpoch: currentEpochEntries(addr),
        history: allEpochRecords(addr),
      });
    },
  );
}
