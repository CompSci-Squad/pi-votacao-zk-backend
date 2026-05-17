"use strict";

/**
 * Admin GET helpers.
 *
 * These endpoints prepare information for a client-side admin UI.
 * The backend never holds an admin key — all state-changing admin
 * transactions are signed directly by the admin's wallet (MetaMask, etc.).
 *
 * Provided helpers:
 *   GET /events/:addr/admin/state        — full event state + races
 *   GET /events/:addr/admin/voters       — voter hash list (public, auditable)
 */

import type { FastifyInstance } from "fastify";
import { readEventState, readRaces, getVotingContract } from "../chain/event";
import { toSafeJson } from "../lib/serialize";

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { addr: string } }>(
    "/events/:addr/admin/state",
    async (req, reply) => {
      const { addr } = req.params;
      const [state, races] = await Promise.all([
        readEventState(addr),
        readRaces(addr),
      ]);
      reply.send(toSafeJson({ ...state, races }));
    },
  );

  fastify.get<{ Params: { addr: string } }>(
    "/events/:addr/admin/voters",
    async (req, reply) => {
      const c = getVotingContract(req.params.addr);
      const hashes: bigint[] = await c.getVoterHashes();
      reply.send(toSafeJson({ voterHashes: hashes, count: hashes.length }));
    },
  );
}
