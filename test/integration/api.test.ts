"use strict";

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

import { expect } from "chai";
import { ethers } from "ethers";
import {
  isAnvilReachable,
  deployTestEnv,
  teardown,
  type TestContext,
} from "./helpers/setup";

// ── Conditional skip ──────────────────────────────────────────────────────────

describe("Integration API", function () {
  this.timeout(60_000);

  let ctx: TestContext;
  let skip = false;

  before(async () => {
    if (!(await isAnvilReachable())) {
      console.warn("  [SKIP] anvil not reachable — skipping integration tests");
      skip = true;
      return;
    }
    ctx = await deployTestEnv();
  });

  after(async () => {
    if (!skip && ctx) await teardown(ctx);
  });

  // ── /health ───────────────────────────────────────────────────────────────

  it("GET /health returns ok", async function () {
    if (skip) return this.skip();
    const res = await ctx.fastify.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).to.equal(200);
    expect(JSON.parse(res.body).ok).to.be.true;
  });

  // ── /events ───────────────────────────────────────────────────────────────

  it("GET /events returns at least one event", async function () {
    if (skip) return this.skip();
    const res = await ctx.fastify.inject({ method: "GET", url: "/events" });
    expect(res.statusCode).to.equal(200);
    const events = JSON.parse(res.body);
    expect(events).to.be.an("array").with.length.gte(1);
    const found = events.find(
      (e: any) => e.address?.toLowerCase() === ctx.contractAddr.toLowerCase(),
    );
    expect(found).to.exist;
  });

  // ── /events/:addr ─────────────────────────────────────────────────────────

  it("GET /events/:addr returns event state", async function () {
    if (skip) return this.skip();
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/events/${ctx.contractAddr}`,
    });
    expect(res.statusCode).to.equal(200);
    const body = JSON.parse(res.body);
    expect(body.currentElectionId).to.be.a("string"); // bigint serialized as string
    expect(body.state).to.be.a("number");
  });

  // ── /events/:addr/results ─────────────────────────────────────────────────

  it("GET /events/:addr/results returns BU document", async function () {
    if (skip) return this.skip();
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/events/${ctx.contractAddr}/results`,
    });
    expect(res.statusCode).to.equal(200);
    const body = JSON.parse(res.body);
    expect(body.type).to.equal("BOLETIM_DE_URNA");
    expect(body.sha256).to.be.a("string").with.length(64);
  });

  // ── /events/:addr/audit/rdv ───────────────────────────────────────────────

  it("GET /events/:addr/audit/rdv returns RDV document", async function () {
    if (skip) return this.skip();
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/events/${ctx.contractAddr}/audit/rdv`,
    });
    expect(res.statusCode).to.equal(200);
    const body = JSON.parse(res.body);
    expect(body.type).to.equal("RDV");
    expect(body.votes).to.be.an("array");
  });

  // ── /events/:addr/voters/:commitment ──────────────────────────────────────

  it("GET /events/:addr/voters/:commitment returns inclusion proof for enrolled voter", async function () {
    if (skip) return this.skip();
    // commitment = 1n (registered in setup)
    const commitment = "1";
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/events/${ctx.contractAddr}/voters/${commitment}`,
    });
    expect(res.statusCode).to.equal(200);
    const body = JSON.parse(res.body);
    expect(body.included).to.be.true;
    expect(body.leafIndex).to.equal(0);
    expect(body.pathElements).to.have.length(4);
    expect(body.pathIndices).to.have.length(4);
  });

  it("GET /events/:addr/voters/:commitment returns included=false for unknown voter", async function () {
    if (skip) return this.skip();
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/events/${ctx.contractAddr}/voters/99999`,
    });
    expect(res.statusCode).to.equal(200);
    const body = JSON.parse(res.body);
    expect(body.included).to.be.false;
  });

  // ── POST /events/:addr/relay (requires OPEN state) ────────────────────────

  it("POST /events/:addr/relay is rejected when election is PENDING (400)", async function () {
    if (skip) return this.skip();
    // Election is still PENDING after setup (openElection not called in setup)
    const body = {
      raceId: 0,
      pubSignals: [
        "12345",   // merkle_root
        "99999",   // nullifier
        "1",       // candidate_id
        "1",       // election_id
        "0",       // race_id
        "0",       // pick_index
      ],
      proof: Array.from({ length: 24 }, (_, i) => String(i + 1)),
    };
    const res = await ctx.fastify.inject({
      method: "POST",
      url: `/events/${ctx.contractAddr}/relay`,
      payload: body,
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).to.equal(400);
    expect(JSON.parse(res.body).code).to.equal("ELECTION_NOT_OPEN");
  });

  // ── /events/:addr/audit/pending ───────────────────────────────────────────

  it("GET /events/:addr/audit/pending returns log structure", async function () {
    if (skip) return this.skip();
    const res = await ctx.fastify.inject({
      method: "GET",
      url: `/events/${ctx.contractAddr}/audit/pending`,
    });
    expect(res.statusCode).to.equal(200);
    const body = JSON.parse(res.body);
    expect(body).to.have.property("currentEpoch").that.is.an("array");
    expect(body).to.have.property("history").that.is.an("array");
  });
});
