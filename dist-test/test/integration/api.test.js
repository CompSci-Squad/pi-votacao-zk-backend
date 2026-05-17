"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Integration API tests.
 *
 * These tests require a running anvil node and compiled Foundry artifacts.
 * They are skipped automatically when anvil is not reachable.
 *
 * Run:
 *   cd ../pi-votacao-zk-blockchain && forge build
 *   anvil &
 *   cd ../pi-votacao-zk-backend && npm run test:integration
 */
const chai_1 = require("chai");
const setup_1 = require("./helpers/setup");
// ── Conditional skip ──────────────────────────────────────────────────────────
describe("Integration API", function () {
    this.timeout(60_000);
    let ctx;
    let skip = false;
    before(async () => {
        if (!(await (0, setup_1.isAnvilReachable)())) {
            console.warn("  [SKIP] anvil not reachable — skipping integration tests");
            skip = true;
            return;
        }
        ctx = await (0, setup_1.deployTestEnv)();
    });
    after(async () => {
        if (!skip && ctx)
            await (0, setup_1.teardown)(ctx);
    });
    // ── /health ───────────────────────────────────────────────────────────────
    it("GET /health returns ok", async function () {
        if (skip)
            return this.skip();
        const res = await ctx.fastify.inject({ method: "GET", url: "/health" });
        (0, chai_1.expect)(res.statusCode).to.equal(200);
        (0, chai_1.expect)(JSON.parse(res.body).ok).to.be.true;
    });
    // ── /events ───────────────────────────────────────────────────────────────
    it("GET /events returns at least one event", async function () {
        if (skip)
            return this.skip();
        const res = await ctx.fastify.inject({ method: "GET", url: "/events" });
        (0, chai_1.expect)(res.statusCode).to.equal(200);
        const events = JSON.parse(res.body);
        (0, chai_1.expect)(events).to.be.an("array").with.length.gte(1);
        const found = events.find((e) => e.address?.toLowerCase() === ctx.contractAddr.toLowerCase());
        (0, chai_1.expect)(found).to.exist;
    });
    // ── /events/:addr ─────────────────────────────────────────────────────────
    it("GET /events/:addr returns event state", async function () {
        if (skip)
            return this.skip();
        const res = await ctx.fastify.inject({
            method: "GET",
            url: `/events/${ctx.contractAddr}`,
        });
        (0, chai_1.expect)(res.statusCode).to.equal(200);
        const body = JSON.parse(res.body);
        (0, chai_1.expect)(body.currentElectionId).to.be.a("string"); // bigint serialized as string
        (0, chai_1.expect)(body.state).to.be.a("number");
    });
    // ── /events/:addr/results ─────────────────────────────────────────────────
    it("GET /events/:addr/results returns BU document", async function () {
        if (skip)
            return this.skip();
        const res = await ctx.fastify.inject({
            method: "GET",
            url: `/events/${ctx.contractAddr}/results`,
        });
        (0, chai_1.expect)(res.statusCode).to.equal(200);
        const body = JSON.parse(res.body);
        (0, chai_1.expect)(body.type).to.equal("BOLETIM_DE_URNA");
        (0, chai_1.expect)(body.sha256).to.be.a("string").with.length(64);
    });
    // ── /events/:addr/audit/rdv ───────────────────────────────────────────────
    it("GET /events/:addr/audit/rdv returns RDV document", async function () {
        if (skip)
            return this.skip();
        const res = await ctx.fastify.inject({
            method: "GET",
            url: `/events/${ctx.contractAddr}/audit/rdv`,
        });
        (0, chai_1.expect)(res.statusCode).to.equal(200);
        const body = JSON.parse(res.body);
        (0, chai_1.expect)(body.type).to.equal("RDV");
        (0, chai_1.expect)(body.votes).to.be.an("array");
    });
    // ── /events/:addr/voters/:commitment ──────────────────────────────────────
    it("GET /events/:addr/voters/:commitment returns inclusion proof for enrolled voter", async function () {
        if (skip)
            return this.skip();
        // commitment = 1n (registered in setup)
        const commitment = "1";
        const res = await ctx.fastify.inject({
            method: "GET",
            url: `/events/${ctx.contractAddr}/voters/${commitment}`,
        });
        (0, chai_1.expect)(res.statusCode).to.equal(200);
        const body = JSON.parse(res.body);
        (0, chai_1.expect)(body.included).to.be.true;
        (0, chai_1.expect)(body.leafIndex).to.equal(0);
        (0, chai_1.expect)(body.pathElements).to.have.length(4);
        (0, chai_1.expect)(body.pathIndices).to.have.length(4);
    });
    it("GET /events/:addr/voters/:commitment returns included=false for unknown voter", async function () {
        if (skip)
            return this.skip();
        const res = await ctx.fastify.inject({
            method: "GET",
            url: `/events/${ctx.contractAddr}/voters/99999`,
        });
        (0, chai_1.expect)(res.statusCode).to.equal(200);
        const body = JSON.parse(res.body);
        (0, chai_1.expect)(body.included).to.be.false;
    });
    // ── POST /events/:addr/relay (requires OPEN state) ────────────────────────
    it("POST /events/:addr/relay is rejected when election is PENDING (400)", async function () {
        if (skip)
            return this.skip();
        // Election is still PENDING after setup (openElection not called in setup)
        const body = {
            raceId: 0,
            pubSignals: [
                "12345", // merkle_root
                "99999", // nullifier
                "1", // candidate_id
                "1", // election_id
                "0", // race_id
                "0", // pick_index
            ],
            proof: Array.from({ length: 24 }, (_, i) => String(i + 1)),
        };
        const res = await ctx.fastify.inject({
            method: "POST",
            url: `/events/${ctx.contractAddr}/relay`,
            payload: body,
            headers: { "content-type": "application/json" },
        });
        (0, chai_1.expect)(res.statusCode).to.equal(400);
        (0, chai_1.expect)(JSON.parse(res.body).code).to.equal("ELECTION_NOT_OPEN");
    });
    // ── /events/:addr/audit/pending ───────────────────────────────────────────
    it("GET /events/:addr/audit/pending returns log structure", async function () {
        if (skip)
            return this.skip();
        const res = await ctx.fastify.inject({
            method: "GET",
            url: `/events/${ctx.contractAddr}/audit/pending`,
        });
        (0, chai_1.expect)(res.statusCode).to.equal(200);
        const body = JSON.parse(res.body);
        (0, chai_1.expect)(body).to.have.property("currentEpoch").that.is.an("array");
        (0, chai_1.expect)(body).to.have.property("history").that.is.an("array");
    });
});
//# sourceMappingURL=api.test.js.map