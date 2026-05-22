"use strict";

/**
 * elections.ts  —  CRUD routes for elections (VotingContract instances).
 *
 * Mounted at prefix /elections in server.ts.
 * Also mirrored at /events for backwards compatibility.
 *
 * Routes (relative to prefix):
 *   GET  /            → list all elections
 *   POST /            → create election  (factory.createEvent)
 *   GET  /:addr       → election details
 *   PATCH /:addr      → state transition (open / close)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listEvents,
  eventByAddress,
  _invalidateCache,
} from "../chain/factory";
import { readEventState, readRaces } from "../chain/event";
import {
  deployElection,
  openElection,
  closeElection,
} from "../chain/admin";
import { toSafeJson } from "../lib/serialize";
import { notFound, notConfigured, badRequest } from "../lib/errors";
import { validateAddr } from "../lib/validateAddr";
import { requireAdminKey } from "../lib/adminAuth";
import { config } from "../config";

// ── Schemas ───────────────────────────────────────────────────────────────────

const createElectionSchema = z.object({
  /** Election display name shown to voters. */
  name: z.string().min(1, "name is required"),
  /** Short description of the election. */
  description: z.string().min(1, "description is required"),
});

const patchElectionSchema = z.object({
  /**
   * Target state.
   * - "OPEN"     → PENDING → OPEN  (opens voting)
   * - "FINISHED" → OPEN → FINISHED (closes voting, locks results)
   */
  state: z.enum(["OPEN", "FINISHED"]),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function electionsRoutes(fastify: FastifyInstance) {
  // ── GET / ──────────────────────────────────────────────────────────────────
  fastify.get("/", async (_req, reply) => {
    if (!config.factoryAddress) throw notConfigured("FACTORY_ADDRESS");
    const events = await listEvents();
    reply.send(toSafeJson(events));
  });

  // ── POST / ─────────────────────────────────────────────────────────────────
  fastify.post("/", { preHandler: [requireAdminKey] }, async (req, reply) => {
    if (!config.factoryAddress) throw notConfigured("FACTORY_ADDRESS");

    const parse = createElectionSchema.safeParse(req.body);
    if (!parse.success) {
      throw badRequest(
        parse.error.issues.map((i) => i.message).join(", "),
        "INVALID_BODY",
      );
    }

    const { name, description } = parse.data;
    const result = await deployElection(name, description);
    _invalidateCache();
    reply.status(201).send(toSafeJson(result));
  });

  // ── GET /:addr ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/:addr",
    async (req, reply) => {
      if (!config.factoryAddress) throw notConfigured("FACTORY_ADDRESS");
      const { addr } = req.params;
      validateAddr(addr);
      const summary = await eventByAddress(addr);
      if (!summary) throw notFound(`No election at address ${addr}`);

      const [state, races] = await Promise.all([
        readEventState(addr),
        readRaces(addr),
      ]);
      reply.send(toSafeJson({ ...summary, ...state, races }));
    },
  );

  // ── PATCH /:addr ───────────────────────────────────────────────────────────
  fastify.patch<{ Params: { addr: string } }>(
    "/:addr",
    { preHandler: [requireAdminKey] },
    async (req, reply) => {
      if (!config.factoryAddress) throw notConfigured("FACTORY_ADDRESS");
      const { addr } = req.params;
      validateAddr(addr);
      const summary = await eventByAddress(addr);
      if (!summary) throw notFound(`No election at address ${addr}`);

      const parse = patchElectionSchema.safeParse(req.body);
      if (!parse.success) {
        throw badRequest(
          parse.error.issues.map((i) => i.message).join(", "),
          "INVALID_BODY",
        );
      }

      const result =
        parse.data.state === "OPEN"
          ? await openElection(addr)
          : await closeElection(addr);

      reply.send(toSafeJson(result));
    },
  );
}
