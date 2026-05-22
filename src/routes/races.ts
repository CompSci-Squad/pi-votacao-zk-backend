"use strict";

/**
 * races.ts  —  CRUD routes for races within an election.
 *
 * Mounted at prefix /elections (and /events for compat) in server.ts.
 *
 * Routes (relative to prefix):
 *   GET   /:addr/races              → list all races
 *   POST  /:addr/races              → create a new race (raceId ≥ 1)
 *   GET   /:addr/races/:raceId      → single race details
 *   PATCH /:addr/races/:raceId      → update name (race 0 only) or maxPicks
 *
 * Race 0 is the default race that always exists.  Its name can be changed
 * while PENDING via PATCH.  Additional races are created via POST.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readRaces } from "../chain/event";
import { addRace, setRace0Name, setRaceMaxPicks } from "../chain/admin";
import { toSafeJson } from "../lib/serialize";
import { notFound, badRequest } from "../lib/errors";
import { validateAddr } from "../lib/validateAddr";
import { requireAdminKey } from "../lib/adminAuth";

// ── Schemas ───────────────────────────────────────────────────────────────────

const createRaceSchema = z.object({
  /** Race display name (e.g. "Presidente", "Governador"). */
  name: z.string().min(1, "name is required"),
});

const patchRaceSchema = z
  .object({
    /** New display name — only accepted for race 0, set via setRace0Name(). */
    name: z.string().min(1).optional(),
    /**
     * Maximum picks per voter for this race.
     * 1 = single-choice (default).  >1 = multi-choice (voter casts N proofs).
     */
    maxPicks: z.number().int().min(1).optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.maxPicks !== undefined,
    "At least one of name or maxPicks must be provided",
  );

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function racesRoutes(fastify: FastifyInstance) {
  // ── GET /:addr/races ───────────────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/:addr/races",
    async (req, reply) => {
      validateAddr(req.params.addr);
      const races = await readRaces(req.params.addr);
      reply.send(toSafeJson(races));
    },
  );

  // ── POST /:addr/races ──────────────────────────────────────────────────────
  fastify.post<{ Params: { addr: string } }>(
    "/:addr/races",
    { preHandler: [requireAdminKey] },
    async (req, reply) => {
      const { addr } = req.params;
      validateAddr(addr);
      const parse = createRaceSchema.safeParse(req.body);
      if (!parse.success) {
        throw badRequest(
          parse.error.issues.map((i) => i.message).join(", "),
          "INVALID_BODY",
        );
      }
      const result = await addRace(addr, parse.data.name);
      reply.status(201).send(toSafeJson(result));
    },
  );

  // ── GET /:addr/races/:raceId ───────────────────────────────────────────────
  fastify.get<{ Params: { addr: string; raceId: string } }>(
    "/:addr/races/:raceId",
    async (req, reply) => {
      const { addr, raceId: raceIdStr } = req.params;
      validateAddr(addr);
      const raceId = parseInt(raceIdStr, 10);
      if (isNaN(raceId)) throw badRequest("raceId must be an integer", "INVALID_PARAM");

      const races = await readRaces(addr);
      const race = races.find((r) => r.raceId === raceId);
      if (!race) throw notFound(`Race ${raceId} not found`);
      reply.send(toSafeJson(race));
    },
  );

  // ── PATCH /:addr/races/:raceId ─────────────────────────────────────────────
  fastify.patch<{ Params: { addr: string; raceId: string } }>(
    "/:addr/races/:raceId",
    { preHandler: [requireAdminKey] },
    async (req, reply) => {
      const { addr, raceId: raceIdStr } = req.params;
      validateAddr(addr);
      const raceId = parseInt(raceIdStr, 10);
      if (isNaN(raceId)) throw badRequest("raceId must be an integer", "INVALID_PARAM");

      const parse = patchRaceSchema.safeParse(req.body);
      if (!parse.success) {
        throw badRequest(
          parse.error.issues.map((i) => i.message).join(", "),
          "INVALID_BODY",
        );
      }

      const results: object[] = [];

      if (parse.data.name !== undefined) {
        if (raceId !== 0) {
          throw badRequest(
            "Race name can only be updated for race 0; provide the name when creating races ≥ 1",
            "IMMUTABLE_RACE_NAME",
          );
        }
        results.push(await setRace0Name(addr, parse.data.name));
      }

      if (parse.data.maxPicks !== undefined) {
        results.push(await setRaceMaxPicks(addr, raceId, parse.data.maxPicks));
      }

      reply.send(toSafeJson(results));
    },
  );
}
