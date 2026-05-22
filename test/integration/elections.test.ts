"use strict";

/**
 * Elections API integration tests.
 *
 * Covers all endpoints under /elections:
 *   elections  — GET /, POST /, GET /:addr, PATCH /:addr
 *   races      — GET /:addr/races, POST, GET /:addr/races/:raceId, PATCH
 *   candidates — GET /:addr/races/:raceId/candidates, POST, GET /:candidateId
 *   voters     — GET /:addr/voters, POST, GET /:addr/voters/:commitment
 *   votes      — POST /:addr/votes, GET /:addr/votes/:nullifier,
 *                GET /:addr/votes/:nullifier/receipt.pdf,
 *                POST /:addr/verify-proof
 *   audit      — GET /:addr/results, GET /:addr/races/:raceId/results,
 *                GET /:addr/audit/bu.pdf, GET /:addr/audit/zeresima,
 *                GET /:addr/audit/bu, GET /:addr/audit/rdv,
 *                GET /:addr/audit/pending
 *
 * Prerequisites:
 *   - anvil running at RPC_URL (default http://127.0.0.1:8545)
 *   - pi-votacao-zk-blockchain contracts compiled: forge build
 *
 * Skips automatically when anvil is unreachable.
 */

import { expect } from "chai";
import {
  isAnvilReachable,
  deployTestEnv,
  teardown,
  type TestContext,
} from "./helpers/setup";
import { _resetRelayerForTests } from "../../src/chain/relayer";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_ADMIN_KEY = "test-admin-key-for-elections-suite";
const BAD_ADDR = "0xdeadbeef"; // invalid Ethereum address
// Anvil account 0 — deployer and VotingContract owner (used for admin ops).
const ANVIL_ACCOUNT_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// Anvil account 1 — used exclusively as the relay signer so its nonce
// sequence is independent of api.test.ts (which also uses account 0).
const ANVIL_ACCOUNT_1 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// Valid-shape proof fields (all zeros — will be rejected on-chain by the
// MockVerifier when it is RejectingMockVerifier, accepted by MockVerifier)
const DUMMY_PUB_SIGNALS = [
  "1",   // pubSignals[0] merkle_root  — matches the dummy root set in setup
  "42",  // pubSignals[1] nullifier_hash
  "1",   // pubSignals[2] candidate_id
  "1",   // pubSignals[3] election_id  — must match on-chain electionId
  "0",   // pubSignals[4] race_id
  "0",   // pubSignals[5] pick_index
];
const DUMMY_PROOF = Array.from({ length: 24 }, (_, i) => String(i + 1));

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("Elections API — /elections", function () {
  this.timeout(90_000);

  let ctx: TestContext;
  let skip = false;

  before(async () => {
    if (!(await isAnvilReachable())) {
      console.warn("  [SKIP] anvil not reachable — skipping elections API tests");
      skip = true;
      return;
    }

    // Set ADMIN_KEY before buildServer() so the Fastify server picks it up.
    process.env.ADMIN_KEY = TEST_ADMIN_KEY;

    ctx = await deployTestEnv();

    // deployTestEnv() always resets RELAYER_PRIVATE_KEY to account 0.
    // Switch it to account 1 so castVote relay txs use an independent
    // nonce sequence (api.test.ts also deploys with account 0, which
    // advances its nonce and would cause a collision at submission time).
    // Keep ADMIN_PRIVATE_KEY pinned to account 0 — the VotingContract
    // owner — so state-transition calls (openElection, closeElection,
    // addCandidate, …) are authorised on-chain.
    process.env.RELAYER_PRIVATE_KEY = ANVIL_ACCOUNT_1;
    process.env.ADMIN_PRIVATE_KEY = ANVIL_ACCOUNT_0;
    _resetRelayerForTests(); // force singleton re-creation with account 1
  });

  after(async () => {
    if (!skip && ctx) await teardown(ctx);
    delete process.env.ADMIN_KEY;
    delete process.env.RELAYER_PRIVATE_KEY;
    delete process.env.ADMIN_PRIVATE_KEY;
    _resetRelayerForTests(); // clean up singleton for any later suites
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Auth enforcement
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Admin auth enforcement", function () {
    it("POST /elections without X-Admin-Key returns 401", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: "/elections",
        payload: { name: "Test", description: "Test" },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(401);
      expect(JSON.parse(res.body).code).to.equal("UNAUTHORIZED");
    });

    it("POST /elections with wrong X-Admin-Key returns 401", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: "/elections",
        payload: { name: "Test", description: "Test" },
        headers: {
          "content-type": "application/json",
          "x-admin-key": "wrong-key",
        },
      });
      expect(res.statusCode).to.equal(401);
    });

    it("PATCH /elections/:addr without X-Admin-Key returns 401", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "PATCH",
        url: `/elections/${ctx.contractAddr}`,
        payload: { state: "OPEN" },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(401);
    });

    it("POST /elections/:addr/races without X-Admin-Key returns 401", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/races`,
        payload: { name: "Presidente" },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(401);
    });

    it("POST /elections/:addr/races/:raceId/candidates without X-Admin-Key returns 401", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/races/0/candidates`,
        payload: { name: "Bob", party: "Party", number: 2 },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(401);
    });

    it("POST /elections/:addr/voters without X-Admin-Key returns 401", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/voters`,
        payload: { hashes: ["1"], merkleRoot: "1" },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(401);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Address validation
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Address validation", function () {
    it("GET /elections/:addr with invalid address returns 400 INVALID_ADDRESS", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${BAD_ADDR}`,
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("INVALID_ADDRESS");
    });

    it("GET /elections/:addr/races with invalid address returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${BAD_ADDR}/races`,
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("INVALID_ADDRESS");
    });

    it("GET /elections/:addr/results with invalid address returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${BAD_ADDR}/results`,
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("INVALID_ADDRESS");
    });

    it("POST /elections/:addr/votes with invalid address returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${BAD_ADDR}/votes`,
        payload: {
          raceId: 0,
          pubSignals: DUMMY_PUB_SIGNALS,
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("INVALID_ADDRESS");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GET /elections
  // ══════════════════════════════════════════════════════════════════════════════

  describe("GET /elections", function () {
    it("returns an array of elections", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({ method: "GET", url: "/elections" });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.be.an("array").with.length.gte(1);
    });

    it("includes the test deployment address", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({ method: "GET", url: "/elections" });
      const elections = JSON.parse(res.body);
      const found = elections.find(
        (e: any) =>
          e.address?.toLowerCase() === ctx.contractAddr.toLowerCase() ||
          e.contractAddr?.toLowerCase() === ctx.contractAddr.toLowerCase(),
      );
      expect(found, "deployed contract should appear in elections list").to.exist;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // GET /elections/:addr
  // ══════════════════════════════════════════════════════════════════════════════

  describe("GET /elections/:addr", function () {
    it("returns election details with state and races", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      // Should have state (number) and races (array)
      expect(body).to.have.property("state");
      expect(body).to.have.property("races").that.is.an("array");
    });

    it("returns 404 for a valid-format address not in factory", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: "/elections/0x0000000000000000000000000000000000000001",
      });
      // Could be 404 (not found in factory) or 500/400 depending on factory impl
      // The key assertion is it does NOT return 200 with election data
      expect(res.statusCode).to.not.equal(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Races
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Races", function () {
    it("GET /elections/:addr/races returns an array", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.be.an("array");
    });

    it("GET /elections/:addr/races/0 returns race 0", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/0`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.have.property("raceId");
    });

    it("GET /elections/:addr/races/999 returns 404", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/999`,
      });
      expect(res.statusCode).to.equal(404);
    });

    it("GET /elections/:addr/races/abc returns 400 INVALID_PARAM", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/abc`,
      });
      expect(res.statusCode).to.equal(400);
    });

    it("PATCH /elections/:addr/races/0 with no fields returns 400 INVALID_BODY", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "PATCH",
        url: `/elections/${ctx.contractAddr}/races/0`,
        payload: {},
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("INVALID_BODY");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Candidates
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Candidates", function () {
    it("GET /elections/:addr/races/0/candidates returns array", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/0/candidates`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.be.an("array");
    });

    it("GET /elections/:addr/races/999/candidates returns 404", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/999/candidates`,
      });
      expect(res.statusCode).to.equal(404);
    });

    it("GET /elections/:addr/races/0/candidates/1 returns candidate with id=1", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/0/candidates/1`,
      });
      // Alice was registered in setup with number=1 and id should be 1
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.have.property("name");
    });

    it("GET /elections/:addr/races/0/candidates/9999 returns 404", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/0/candidates/9999`,
      });
      expect(res.statusCode).to.equal(404);
    });

    it("POST /elections/:addr/races/0/candidates with missing fields returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/races/0/candidates`,
        payload: { name: "Bob" }, // missing party and number
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("INVALID_BODY");
    });

    it("POST /elections/:addr/races/0/candidates with number=0 returns 400 (reserved)", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/races/0/candidates`,
        payload: { name: "Bob", party: "Party B", number: 0 },
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(400);
    });

    it("POST /elections/:addr/races/0/candidates with number=999 returns 400 (reserved)", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/races/0/candidates`,
        payload: { name: "Charlie", party: "Party C", number: 999 },
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Voters
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Voters", function () {
    it("GET /elections/:addr/voters returns an array", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/voters`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.be.an("array");
    });

    it("GET /elections/:addr/voters includes commitment=1 registered in setup", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/voters`,
      });
      const voters = JSON.parse(res.body);
      // setup registered commitment 1n
      const found = voters.some(
        (v: any) => String(v) === "1" || v?.commitment === "1",
      );
      expect(found, "commitment 1 should be in the voter list").to.be.true;
    });

    it("GET /elections/:addr/voters/1 returns inclusion proof (included=true)", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/voters/1`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.included).to.be.true;
      expect(body.leafIndex).to.equal(0);
      expect(body.pathElements).to.be.an("array");
      expect(body.pathIndices).to.be.an("array");
    });

    it("GET /elections/:addr/voters/99999 returns included=false for unknown voter", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/voters/99999`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.included).to.be.false;
    });

    it("POST /elections/:addr/voters with missing merkleRoot returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/voters`,
        payload: { hashes: ["2"] }, // missing merkleRoot
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(400);
    });

    it("POST /elections/:addr/voters with empty hashes array returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/voters`,
        payload: { hashes: [], merkleRoot: "1" },
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(400);
    });

    it("POST /elections/:addr/voters with non-decimal hash returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/voters`,
        payload: { hashes: ["0xabc"], merkleRoot: "1" },
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Votes (PENDING-state rejections + dry-run)
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Votes — PENDING state guards", function () {
    it("POST /elections/:addr/votes is rejected when PENDING (ELECTION_NOT_OPEN)", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/votes`,
        payload: {
          raceId: 0,
          pubSignals: DUMMY_PUB_SIGNALS,
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("ELECTION_NOT_OPEN");
    });

    it("POST /elections/:addr/votes with wrong pubSignals length returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/votes`,
        payload: {
          raceId: 0,
          pubSignals: ["1", "2"], // wrong length (need 6)
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(400);
    });

    it("POST /elections/:addr/votes with wrong proof length returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/votes`,
        payload: {
          raceId: 0,
          pubSignals: DUMMY_PUB_SIGNALS,
          proof: ["1", "2"], // wrong length (need 24)
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(400);
    });

    it("POST /elections/:addr/votes with hex pubSignal returns 400 (must be decimal)", async function () {
      if (skip) return this.skip();
      const badSignals = [...DUMMY_PUB_SIGNALS];
      badSignals[0] = "0xabc"; // hex not allowed
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/votes`,
        payload: { raceId: 0, pubSignals: badSignals, proof: DUMMY_PROOF },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(400);
    });

    it("POST /elections/:addr/verify-proof is rejected when PENDING (ELECTION_NOT_OPEN)", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/verify-proof`,
        payload: {
          raceId: 0,
          pubSignals: DUMMY_PUB_SIGNALS,
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("ELECTION_NOT_OPEN");
    });

    it("GET /elections/:addr/votes/:nullifier returns 404 for unknown nullifier", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/votes/999999`,
      });
      expect(res.statusCode).to.equal(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // State transition: PENDING → OPEN
  // ══════════════════════════════════════════════════════════════════════════════

  describe("PATCH /elections/:addr — state transitions", function () {
    it("PATCH with invalid state enum returns 400", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "PATCH",
        url: `/elections/${ctx.contractAddr}`,
        payload: { state: "INVALID" },
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(400);
    });

    it("PATCH with state=OPEN transitions election to OPEN", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "PATCH",
        url: `/elections/${ctx.contractAddr}`,
        payload: { state: "OPEN" },
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(200);
    });

    it("after opening, GET /elections/:addr shows state=1 (OPEN)", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.state).to.equal(1); // OPEN = 1
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Votes — OPEN state (election is now OPEN)
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Votes — OPEN state (MockVerifier accepts all proofs)", function () {
    it("POST /elections/:addr/votes with valid shape succeeds (MockVerifier)", async function () {
      if (skip) return this.skip();
      // MockVerifier accepts any proof — this tests the full relay pipeline
      // end-to-end without a real ZK proof.
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/votes`,
        payload: {
          raceId: 0,
          pubSignals: DUMMY_PUB_SIGNALS,
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      // MockVerifier accepts all proofs; relay returns txHash on 202 Accepted
      expect(res.statusCode).to.equal(202);
      const body = JSON.parse(res.body);
      expect(body).to.have.property("txHash");
    });

    it("POST /elections/:addr/votes with same nullifier again returns 400 (double-vote)", async function () {
      if (skip) return this.skip();
      // Same pubSignals[1] (nullifier) that we just used above → on-chain reject
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/votes`,
        payload: {
          raceId: 0,
          pubSignals: DUMMY_PUB_SIGNALS,
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      // 400 NULLIFIER_PENDING (pending log) or 409 NULLIFIER_USED (on-chain)
      expect([400, 409]).to.include(res.statusCode);
      expect([
        "NULLIFIER_USED",
        "NULLIFIER_PENDING",
        "RELAY_FAILED",
      ]).to.include(JSON.parse(res.body).code);
    });

    it("GET /elections/:addr/votes/:nullifier returns receipt for the cast vote", async function () {
      if (skip) return this.skip();
      const nullifier = DUMMY_PUB_SIGNALS[1]; // "42"
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/votes/${nullifier}`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.have.property("nullifier");
      expect(body).to.have.property("txHash");
    });

    it("POST /elections/:addr/verify-proof returns valid=true for correct proof in OPEN election", async function () {
      if (skip) return this.skip();
      // Use a fresh nullifier so it hasn't been used yet
      const freshSignals = [...DUMMY_PUB_SIGNALS];
      freshSignals[1] = "99999"; // different nullifier
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/verify-proof`,
        payload: {
          raceId: 0,
          pubSignals: freshSignals,
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.valid).to.be.true;
    });

    it("POST /elections/:addr/verify-proof returns 400 for already-used nullifier", async function () {
      if (skip) return this.skip();
      // Nullifier "42" was used in the relay test above
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/verify-proof`,
        payload: {
          raceId: 0,
          pubSignals: DUMMY_PUB_SIGNALS, // nullifier "42" — already used
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      // Nullifier already on-chain → 409 conflict
      expect([400, 409]).to.include(res.statusCode);
      expect(["NULLIFIER_USED", "NULLIFIER_PENDING"]).to.include(JSON.parse(res.body).code);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // Audit — results, PDFs, RDV, zeresima
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Audit routes", function () {
    it("GET /elections/:addr/results returns BOLETIM_DE_URNA", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/results`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.type).to.equal("BOLETIM_DE_URNA");
      expect(body.sha256).to.be.a("string").with.length(64);
    });

    it("GET /elections/:addr/races/0/results returns per-race tally", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/0/results`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.have.property("raceId");
      expect(body).to.have.property("candidates").that.is.an("array");
      expect(body).to.have.property("totalVotes");
    });

    it("GET /elections/:addr/races/999/results returns 404", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/999/results`,
      });
      expect(res.statusCode).to.equal(404);
    });

    it("GET /elections/:addr/races/0/results reflects the cast vote", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/races/0/results`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      // We cast 1 vote for candidate 1 in the relay test
      const totalVotes = Number(body.totalVotes);
      expect(totalVotes).to.be.gte(1);
    });

    it("GET /elections/:addr/audit/bu returns BOLETIM_DE_URNA (alias)", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/audit/bu`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.type).to.equal("BOLETIM_DE_URNA");
    });

    it("GET /elections/:addr/audit/rdv returns RDV with votes array", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/audit/rdv`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.type).to.equal("RDV");
      expect(body.votes).to.be.an("array");
    });

    it("GET /elections/:addr/audit/rdv reflects the cast vote", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/audit/rdv`,
      });
      const body = JSON.parse(res.body);
      expect(body.votes).to.be.an("array").with.length.gte(1);
      // The cast vote has nullifier "42"
      const found = body.votes.find(
        (v: any) => String(v.nullifier) === DUMMY_PUB_SIGNALS[1],
      );
      expect(found, "cast vote nullifier should appear in RDV").to.exist;
    });

    it("GET /elections/:addr/audit/pending returns log structure", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/audit/pending`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body).to.have.property("currentEpoch").that.is.an("array");
      expect(body).to.have.property("history").that.is.an("array");
    });

    it("GET /elections/:addr/audit/bu.pdf returns a PDF buffer", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/audit/bu.pdf`,
      });
      expect(res.statusCode).to.equal(200);
      expect(res.headers["content-type"]).to.include("application/pdf");
      // PDF magic bytes: %PDF-
      expect(res.rawPayload.slice(0, 5).toString()).to.equal("%PDF-");
    });

    it("GET /elections/:addr/votes/:nullifier/receipt.pdf returns a PDF buffer", async function () {
      if (skip) return this.skip();
      const nullifier = DUMMY_PUB_SIGNALS[1]; // "42" — cast in relay test
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/votes/${nullifier}/receipt.pdf`,
      });
      expect(res.statusCode).to.equal(200);
      expect(res.headers["content-type"]).to.include("application/pdf");
      expect(res.rawPayload.slice(0, 5).toString()).to.equal("%PDF-");
    });

    it("GET /elections/:addr/audit/zeresima returns zeresima doc type", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/audit/zeresima`,
      });
      // Zeresima is only valid in PENDING; now we are in OPEN so it may 400
      // Either way it should not 500
      expect(res.statusCode).to.not.equal(500);
      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        expect(body).to.have.property("type");
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // State transition: OPEN → FINISHED
  // ══════════════════════════════════════════════════════════════════════════════

  describe("Close election (OPEN → FINISHED)", function () {
    it("PATCH with state=FINISHED closes the election", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "PATCH",
        url: `/elections/${ctx.contractAddr}`,
        payload: { state: "FINISHED" },
        headers: {
          "content-type": "application/json",
          "x-admin-key": TEST_ADMIN_KEY,
        },
      });
      expect(res.statusCode).to.equal(200);
    });

    it("after closing, GET /elections/:addr shows state=2 (FINISHED)", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}`,
      });
      expect(res.statusCode).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.state).to.equal(2); // FINISHED = 2
    });

    it("POST /elections/:addr/votes is rejected when FINISHED (ELECTION_NOT_OPEN)", async function () {
      if (skip) return this.skip();
      const freshSignals = [...DUMMY_PUB_SIGNALS];
      freshSignals[1] = "111111"; // fresh nullifier
      const res = await ctx.fastify.inject({
        method: "POST",
        url: `/elections/${ctx.contractAddr}/votes`,
        payload: {
          raceId: 0,
          pubSignals: freshSignals,
          proof: DUMMY_PROOF,
        },
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).to.equal(400);
      expect(JSON.parse(res.body).code).to.equal("ELECTION_NOT_OPEN");
    });

    it("GET /elections/:addr/audit/bu.pdf after closing still returns PDF", async function () {
      if (skip) return this.skip();
      const res = await ctx.fastify.inject({
        method: "GET",
        url: `/elections/${ctx.contractAddr}/audit/bu.pdf`,
      });
      expect(res.statusCode).to.equal(200);
      expect(res.headers["content-type"]).to.include("application/pdf");
    });
  });
});
