"use strict";

import type { FastifyInstance } from "fastify";
import { listEvents, eventByAddress } from "../chain/factory";
import { readEventState, readRaces } from "../chain/event";
import { toSafeJson } from "../lib/serialize";
import { notFound, notConfigured } from "../lib/errors";
import { config } from "../config";
import { buildBoletimUrna } from "../audit/bu";
import { buildZeresima } from "../audit/zeresima";
import { buildRdv } from "../audit/rdv";
import {
  currentEpochEntries,
  allEpochRecords,
} from "../audit/pendingLog";

export default async function publicRoutes(fastify: FastifyInstance) {
  // ── GET /health ─────────────────────────────────────────────────────────────
  fastify.get("/health", async (_req, reply) => {
    reply.send({ ok: true, ts: Date.now() });
  });

  // ── GET /events ─────────────────────────────────────────────────────────────
  fastify.get("/events", async (_req, reply) => {
    if (!config.factoryAddress) throw notConfigured("FACTORY_ADDRESS");
    const events = await listEvents();
    reply.send(toSafeJson(events));
  });

  // ── GET /events/:addr ───────────────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/events/:addr",
    async (req, reply) => {
      if (!config.factoryAddress) throw notConfigured("FACTORY_ADDRESS");
      const { addr } = req.params;
      const summary = await eventByAddress(addr);
      if (!summary) throw notFound(`No event at address ${addr}`);

      const [state, races] = await Promise.all([
        readEventState(addr),
        readRaces(addr),
      ]);

      reply.send(
        toSafeJson({
          ...summary,
          ...state,
          races,
        }),
      );
    },
  );

  // ── GET /events/:addr/results ───────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/events/:addr/results",
    async (req, reply) => {
      const bu = await buildBoletimUrna(req.params.addr);
      reply.send(toSafeJson(bu));
    },
  );

  // ── GET /events/:addr/audit/zeresima ───────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/events/:addr/audit/zeresima",
    async (req, reply) => {
      const doc = await buildZeresima(req.params.addr);
      reply.send(toSafeJson(doc));
    },
  );

  // ── GET /events/:addr/audit/bu ──────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/events/:addr/audit/bu",
    async (req, reply) => {
      const doc = await buildBoletimUrna(req.params.addr);
      reply.send(toSafeJson(doc));
    },
  );

  // ── GET /events/:addr/audit/rdv ──────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/events/:addr/audit/rdv",
    async (req, reply) => {
      const doc = await buildRdv(req.params.addr);
      reply.send(toSafeJson(doc));
    },
  );

  // ── GET /events/:addr/audit/pending ────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/events/:addr/audit/pending",
    async (req, reply) => {
      const { addr } = req.params;
      reply.send({
        currentEpoch: currentEpochEntries(addr),
        history: allEpochRecords(addr),
      });
    },
  );
}
