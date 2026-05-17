"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = publicRoutes;
const factory_1 = require("../chain/factory");
const event_1 = require("../chain/event");
const serialize_1 = require("../lib/serialize");
const errors_1 = require("../lib/errors");
const config_1 = require("../config");
const bu_1 = require("../audit/bu");
const zeresima_1 = require("../audit/zeresima");
const rdv_1 = require("../audit/rdv");
const pendingLog_1 = require("../audit/pendingLog");
async function publicRoutes(fastify) {
    // ── GET /health ─────────────────────────────────────────────────────────────
    fastify.get("/health", async (_req, reply) => {
        reply.send({ ok: true, ts: Date.now() });
    });
    // ── GET /events ─────────────────────────────────────────────────────────────
    fastify.get("/events", async (_req, reply) => {
        if (!config_1.config.factoryAddress)
            throw (0, errors_1.notConfigured)("FACTORY_ADDRESS");
        const events = await (0, factory_1.listEvents)();
        reply.send((0, serialize_1.toSafeJson)(events));
    });
    // ── GET /events/:addr ───────────────────────────────────────────────────────
    fastify.get("/events/:addr", async (req, reply) => {
        if (!config_1.config.factoryAddress)
            throw (0, errors_1.notConfigured)("FACTORY_ADDRESS");
        const { addr } = req.params;
        const summary = await (0, factory_1.eventByAddress)(addr);
        if (!summary)
            throw (0, errors_1.notFound)(`No event at address ${addr}`);
        const [state, races] = await Promise.all([
            (0, event_1.readEventState)(addr),
            (0, event_1.readRaces)(addr),
        ]);
        reply.send((0, serialize_1.toSafeJson)({
            ...summary,
            ...state,
            races,
        }));
    });
    // ── GET /events/:addr/results ───────────────────────────────────────────────
    fastify.get("/events/:addr/results", async (req, reply) => {
        const bu = await (0, bu_1.buildBoletimUrna)(req.params.addr);
        reply.send((0, serialize_1.toSafeJson)(bu));
    });
    // ── GET /events/:addr/audit/zeresima ───────────────────────────────────────
    fastify.get("/events/:addr/audit/zeresima", async (req, reply) => {
        const doc = await (0, zeresima_1.buildZeresima)(req.params.addr);
        reply.send((0, serialize_1.toSafeJson)(doc));
    });
    // ── GET /events/:addr/audit/bu ──────────────────────────────────────────────
    fastify.get("/events/:addr/audit/bu", async (req, reply) => {
        const doc = await (0, bu_1.buildBoletimUrna)(req.params.addr);
        reply.send((0, serialize_1.toSafeJson)(doc));
    });
    // ── GET /events/:addr/audit/rdv ──────────────────────────────────────────────
    fastify.get("/events/:addr/audit/rdv", async (req, reply) => {
        const doc = await (0, rdv_1.buildRdv)(req.params.addr);
        reply.send((0, serialize_1.toSafeJson)(doc));
    });
    // ── GET /events/:addr/audit/pending ────────────────────────────────────────
    fastify.get("/events/:addr/audit/pending", async (req, reply) => {
        const { addr } = req.params;
        reply.send({
            currentEpoch: (0, pendingLog_1.currentEpochEntries)(addr),
            history: (0, pendingLog_1.allEpochRecords)(addr),
        });
    });
}
//# sourceMappingURL=public.js.map