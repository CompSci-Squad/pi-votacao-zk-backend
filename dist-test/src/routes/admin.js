"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = adminRoutes;
const event_1 = require("../chain/event");
const serialize_1 = require("../lib/serialize");
async function adminRoutes(fastify) {
    fastify.get("/events/:addr/admin/state", async (req, reply) => {
        const { addr } = req.params;
        const [state, races] = await Promise.all([
            (0, event_1.readEventState)(addr),
            (0, event_1.readRaces)(addr),
        ]);
        reply.send((0, serialize_1.toSafeJson)({ ...state, races }));
    });
    fastify.get("/events/:addr/admin/voters", async (req, reply) => {
        const c = (0, event_1.getVotingContract)(req.params.addr);
        const hashes = await c.getVoterHashes();
        reply.send((0, serialize_1.toSafeJson)({ voterHashes: hashes, count: hashes.length }));
    });
}
//# sourceMappingURL=admin.js.map