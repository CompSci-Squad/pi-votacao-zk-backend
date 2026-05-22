"use strict";

/**
 * candidates.ts  —  CRUD routes for candidates within a race.
 *
 * Mounted at prefix /elections (and /events for compat) in server.ts.
 *
 * Routes (relative to prefix):
 *   GET  /:addr/races/:raceId/candidates              → list candidates
 *   POST /:addr/races/:raceId/candidates              → add candidate
 *   GET  /:addr/races/:raceId/candidates/:candidateId → single candidate
 *
 * Candidates can only be added while the election is PENDING.
 * Candidate IDs start at 1.  Special IDs: 0 = blank vote, 999 = null/spoiled.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readRaces } from "../chain/event";
import { addCandidateToRace } from "../chain/admin";
import { toSafeJson } from "../lib/serialize";
import { notFound, badRequest } from "../lib/errors";
import { validateAddr } from "../lib/validateAddr";
import { requireAdminKey } from "../lib/adminAuth";

// ── Schema ────────────────────────────────────────────────────────────────────

const createCandidateSchema = z.object({
  /** Candidate full name. */
  name: z.string().min(1, "name is required"),
  /** Party name or abbreviation. */
  party: z.string().min(1, "party is required"),
  /**
   * Official ballot number (must be unique within the race).
   * Must be ≥ 1 (0 is reserved for blank votes, 999 for null/spoiled).
   */
  number: z
    .number()
    .int()
    .min(1, "number must be ≥ 1")
    .max(998, "number must be ≤ 998 (999 is reserved for null/spoiled votes)"),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function candidatesRoutes(fastify: FastifyInstance) {
  // ── GET /:addr/races/:raceId/candidates ────────────────────────────────────
  fastify.get<{ Params: { addr: string; raceId: string } }>(
    "/:addr/races/:raceId/candidates",
    async (req, reply) => {
      const { addr, raceId: raceIdStr } = req.params;
      validateAddr(addr);
      const raceId = parseInt(raceIdStr, 10);
      if (isNaN(raceId)) throw badRequest("raceId must be an integer", "INVALID_PARAM");

      const races = await readRaces(addr);
      const race = races.find((r) => r.raceId === raceId);
      if (!race) throw notFound(`Race ${raceId} not found`);
      reply.send(toSafeJson(race.candidates));
    },
  );

  // ── POST /:addr/races/:raceId/candidates ───────────────────────────────────
  fastify.post<{ Params: { addr: string; raceId: string } }>(
    "/:addr/races/:raceId/candidates",
    { preHandler: [requireAdminKey] },
    async (req, reply) => {
      const { addr, raceId: raceIdStr } = req.params;
      validateAddr(addr);
      const raceId = parseInt(raceIdStr, 10);
      if (isNaN(raceId)) throw badRequest("raceId must be an integer", "INVALID_PARAM");

      const parse = createCandidateSchema.safeParse(req.body);
      if (!parse.success) {
        throw badRequest(
          parse.error.issues.map((i) => i.message).join(", "),
          "INVALID_BODY",
        );
      }

      const { name, party, number } = parse.data;
      const result = await addCandidateToRace(
        addr,
        raceId,
        name,
        party,
        BigInt(number),
      );
      reply.status(201).send(toSafeJson(result));
    },
  );

  // ── GET /:addr/races/:raceId/candidates/:candidateId ───────────────────────
  fastify.get<{
    Params: { addr: string; raceId: string; candidateId: string };
  }>(
    "/:addr/races/:raceId/candidates/:candidateId",
    async (req, reply) => {
      const { addr, raceId: raceIdStr, candidateId: candidateIdStr } =
        req.params;
      validateAddr(addr);
      const raceId = parseInt(raceIdStr, 10);
      const candidateId = parseInt(candidateIdStr, 10);
      if (isNaN(raceId) || isNaN(candidateId)) {
        throw badRequest("raceId and candidateId must be integers", "INVALID_PARAM");
      }

      const races = await readRaces(addr);
      const race = races.find((r) => r.raceId === raceId);
      if (!race) throw notFound(`Race ${raceId} not found`);

      const candidate = race.candidates.find((c) => Number(c.id) === candidateId);
      if (!candidate) {
        throw notFound(`Candidate ${candidateId} not found in race ${raceId}`);
      }
      reply.send(toSafeJson(candidate));
    },
  );
}
