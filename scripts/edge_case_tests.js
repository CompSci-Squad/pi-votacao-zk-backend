#!/usr/bin/env node
/**
 * edge_case_tests.js
 *
 * Comprehensive edge case test suite for the backend API.
 * Tests every guard and boundary condition across all routes.
 *
 * Usage:
 *   ADMIN_KEY=dev-admin-secret node scripts/edge_case_tests.js
 *   ADMIN_KEY=dev-admin-secret node scripts/edge_case_tests.js --filter votes
 */

"use strict";

const { buildPoseidon } = require("circomlibjs");
const { execSync }      = require("child_process");
const { writeFileSync, unlinkSync, existsSync } = require("fs");
const path              = require("path");
const http              = require("http");
const https             = require("https");

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE  = process.env.API_BASE  ?? "http://localhost:3000";
const ADMIN_KEY = process.env.ADMIN_KEY ?? "dev-admin-secret";
const _args     = process.argv.slice(2);
const FILTER    = (() => {
  const f = _args.find(a => a.startsWith("--filter="));
  if (f) return f.split("=")[1];
  const i = _args.indexOf("--filter");
  return i !== -1 ? _args[i + 1] : null;
})();

const ZKEY = path.resolve(__dirname, "../../pi-votacao-zk-circuits/artifacts/voter_proof.zkey");
const WASM = path.resolve(__dirname, "../../pi-votacao-zk-circuits/artifacts/voter_proof.wasm");
const SNARKJS = path.resolve(__dirname, "../../pi-votacao-zk-circuits/node_modules/.bin/snarkjs");

const TREE_DEPTH = 4;
const TREE_SIZE  = 1 << TREE_DEPTH;

const VOTER_IDS = [
  12345678901n, 98765432100n, 11122233344n, 55566677788n,
  99900011122n, 33344455566n, 77788899900n, 22233344455n,
];

// ── Results tracker ───────────────────────────────────────────────────────────

let passed = 0, failed = 0, skipped = 0;
const failures = [];

function ok(name)  { passed++;  process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`); }
function fail(name, detail) {
  failed++;
  failures.push({ name, detail });
  process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n    → ${detail}\n`);
}
function skip(name) { skipped++; process.stdout.write(`  \x1b[33m-\x1b[0m ${name} (skipped)\n`); }
function section(name) { process.stdout.write(`\n\x1b[1m${name}\x1b[0m\n`); }

function assert(name, condition, detail = "") {
  condition ? ok(name) : fail(name, detail || "condition was false");
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function req(method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + urlPath);
    const lib = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const headers = {
      "Content-Type": "application/json",
      "X-Admin-Key": ADMIN_KEY,
      ...extraHeaders,
    };
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

    const r = lib.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const get  = (p, h) => req("GET",   p, null, h);
const post = (p, b, h) => req("POST",  p, b, h);
const patch = (p, b, h) => req("PATCH", p, b, h);

// ── Crypto helpers ────────────────────────────────────────────────────────────

function buildTree(poseidon, F, voterIds) {
  const rawLeaves = new Array(TREE_SIZE).fill(null).map(() => F.zero);
  for (let i = 0; i < voterIds.length && i < TREE_SIZE; i++) {
    rawLeaves[i] = poseidon([voterIds[i]]);
  }
  const levels = [rawLeaves];
  for (let d = 0; d < TREE_DEPTH; d++) {
    const prev = levels[d];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(poseidon([prev[i], prev[i+1]]));
    levels.push(next);
  }
  return { levels, root: F.toString(levels[TREE_DEPTH][0]) };
}

function mkProofInput(poseidon, F, tree, voterIds, voterIdx, electionId, raceId, candidateId, pickIndex = 0n) {
  const voterId = voterIds[voterIdx];
  const { levels } = tree;
  const pathElements = [], pathIndices = [];
  let cur = voterIdx;
  for (let d = 0; d < TREE_DEPTH; d++) {
    const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
    pathElements.push(F.toString(levels[d][sib]));
    pathIndices.push(cur % 2);
    cur = Math.floor(cur / 2);
  }
  return {
    voter_id:            voterId.toString(),
    merkle_root:         tree.root,
    merkle_path:         pathElements,
    merkle_path_indices: pathIndices,
    nullifier_hash:      F.toString(poseidon([voterId, electionId, raceId, pickIndex])),
    candidate_id:        candidateId.toString(),
    election_id:         electionId.toString(),
    race_id:             raceId.toString(),
    pick_index:          pickIndex.toString(),
  };
}

function generateProof(circuitInput) {
  const tmpIn  = path.join(__dirname, "_ec_input.json");
  const tmpWtns = path.join(__dirname, "_ec_witness.wtns");
  const tmpProof = path.join(__dirname, "_ec_proof.json");
  const tmpPub   = path.join(__dirname, "_ec_public.json");
  try {
    writeFileSync(tmpIn, JSON.stringify(circuitInput));
    execSync(`${SNARKJS} wtns calculate ${WASM} ${tmpIn} ${tmpWtns}`, { stdio: "pipe" });
    execSync(`${SNARKJS} plonk prove ${ZKEY} ${tmpWtns} ${tmpProof} ${tmpPub}`, { stdio: "pipe" });
    const p   = JSON.parse(require("fs").readFileSync(tmpProof, "utf8"));
    const pub = JSON.parse(require("fs").readFileSync(tmpPub,   "utf8"));
    const proof = [
      p.A[0],p.A[1],p.B[0],p.B[1],p.C[0],p.C[1],p.Z[0],p.Z[1],
      p.T1[0],p.T1[1],p.T2[0],p.T2[1],p.T3[0],p.T3[1],
      p.Wxi[0],p.Wxi[1],p.Wxiw[0],p.Wxiw[1],
      p.eval_a,p.eval_b,p.eval_c,p.eval_s1,p.eval_s2,p.eval_zw,
    ];
    return { proof, pubSignals: pub };
  } finally {
    for (const f of [tmpIn, tmpWtns, tmpProof, tmpPub]) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  }
}

// ── Setup: create a fresh election with real voters and open it ───────────────

async function setupElection(poseidon, F) {
  const created = await post("/elections", {
    name: "Edge Case Test Election",
    description: "Automated edge case test suite",
  });
  if (created.status !== 201) throw new Error(`Setup failed: create election: ${JSON.stringify(created.body)}`);
  const addr = created.body.address;

  // Add race 1
  const raceRes = await post(`/elections/${addr}/races`, { name: "Test Race" });
  if (raceRes.status !== 201 && raceRes.status !== 200)
    throw new Error(`Setup: add race failed: ${JSON.stringify(raceRes.body)}`);
  const raceId = raceRes.body.raceId ?? 1;

  // Add two candidates
  const c1 = await post(`/elections/${addr}/races/${raceId}/candidates`,
    { name: "Alice", party: "A", number: 10 });
  if (c1.status !== 201 && c1.status !== 200)
    throw new Error(`Setup: add candidate 1 failed: ${JSON.stringify(c1.body)}`);

  const c2 = await post(`/elections/${addr}/races/${raceId}/candidates`,
    { name: "Bob", party: "B", number: 11 });

  // Build Poseidon commitments
  // tree is built from raw voter IDs (buildTree hashes them internally with Poseidon)
  // leafCommitments = Poseidon(voter_id) are what gets registered on-chain
  const leafCommitments = VOTER_IDS.map(id => BigInt(F.toString(poseidon([id]))));
  const tree = buildTree(poseidon, F, VOTER_IDS);  // pass raw IDs — buildTree calls poseidon([id]) internally

  // Register voters
  const reg = await post(`/elections/${addr}/voters`, {
    hashes: leafCommitments.map(String),
    merkleRoot: tree.root,
  });
  if (reg.status !== 201 && reg.status !== 200)
    throw new Error(`Setup: register voters failed: ${JSON.stringify(reg.body)}`);

  // Open election
  const opened = await patch(`/elections/${addr}`, { state: "OPEN" });
  if (opened.status !== 200) throw new Error(`Setup: open election failed: ${JSON.stringify(opened.body)}`);

  const detail = (await get(`/elections/${addr}`)).body;
  const electionId = BigInt(detail.currentElectionId);

  return { addr, raceId, electionId, tree, leafCommitments };
}

// ── Test suites ───────────────────────────────────────────────────────────────

async function testHealth() {
  section("Health");
  const r = await get("/health", {});
  assert("GET /health → 200 ok:true", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
}

async function testElections(poseidon, F) {
  section("Elections — CRUD & state transitions");

  // GET /elections
  const list = await get("/elections");
  assert("GET /elections → 200 array", list.status === 200 && Array.isArray(list.body), JSON.stringify(list.body));

  // POST without admin key → 401
  const noAuth = await post("/elections", { name: "X", description: "Y" }, { "X-Admin-Key": "wrong" });
  assert("POST /elections without admin key → 401", noAuth.status === 401,
    `got ${noAuth.status}: ${JSON.stringify(noAuth.body)}`);

  // POST missing required fields → 400
  const missingDesc = await post("/elections", { name: "NoDesc" });
  assert("POST /elections missing description → 400", missingDesc.status === 400,
    `got ${missingDesc.status}: ${JSON.stringify(missingDesc.body)}`);

  // POST valid → 201
  const created = await post("/elections", { name: "Valid Election", description: "Desc" });
  assert("POST /elections valid → 201", created.status === 201 && created.body.address,
    `got ${created.status}: ${JSON.stringify(created.body)}`);
  const addr = created.body.address;

  // Small delay: factory indexes events from the chain — give it a moment
  await new Promise(r => setTimeout(r, 500));

  // GET /:addr → 200
  const detail = await get(`/elections/${addr}`);
  assert("GET /elections/:addr → 200 PENDING", detail.status === 200 && detail.body.stateLabel === "PENDING",
    JSON.stringify(detail.body));

  // GET non-existent addr → 404
  const notFound = await get(`/elections/0x0000000000000000000000000000000000000001`);
  assert("GET /elections/non-existent → 404", notFound.status === 404,
    `got ${notFound.status}: ${JSON.stringify(notFound.body)}`);

  // GET invalid addr → 400
  const badAddr = await get(`/elections/not-an-address`);
  assert("GET /elections/invalid-addr → 400", badAddr.status === 400,
    `got ${badAddr.status}: ${JSON.stringify(badAddr.body)}`);

  // PATCH invalid state value → 400
  const badState = await patch(`/elections/${addr}`, { state: "INVALID" });
  assert("PATCH /elections/:addr invalid state → 400", badState.status === 400,
    `got ${badState.status}: ${JSON.stringify(badState.body)}`);

  // PATCH FINISHED on PENDING (wrong transition) → 400/409
  const badTransition = await patch(`/elections/${addr}`, { state: "FINISHED" });
  assert("PATCH FINISHED on PENDING → 4xx", badTransition.status >= 400 && badTransition.status < 500,
    `got ${badTransition.status}: ${JSON.stringify(badTransition.body)}`);

  return addr;
}

async function testRaces(pendingAddr) {
  section("Races — CRUD");

  // POST race without name → 400
  const noName = await post(`/elections/${pendingAddr}/races`, { name: "" });
  assert("POST race empty name → 400", noName.status === 400,
    `got ${noName.status}: ${JSON.stringify(noName.body)}`);

  // POST valid race → 201
  const raceRes = await post(`/elections/${pendingAddr}/races`, { name: "Race A" });
  assert("POST race valid → 201 with raceId", (raceRes.status === 200 || raceRes.status === 201) && raceRes.body.raceId != null,
    `got ${raceRes.status}: ${JSON.stringify(raceRes.body)}`);
  const raceId = raceRes.body.raceId;

  // GET races
  const races = await get(`/elections/${pendingAddr}/races`);
  assert("GET /races → 200 array", races.status === 200 && Array.isArray(races.body),
    JSON.stringify(races.body));

  // GET single race
  const race = await get(`/elections/${pendingAddr}/races/${raceId}`);
  assert(`GET /races/${raceId} → 200`, race.status === 200 && race.body.raceId === raceId,
    JSON.stringify(race.body));

  // GET non-existent race → 404
  const noRace = await get(`/elections/${pendingAddr}/races/999`);
  assert("GET /races/999 → 404", noRace.status === 404,
    `got ${noRace.status}: ${JSON.stringify(noRace.body)}`);

  return raceId;
}

async function testCandidates(pendingAddr, raceId) {
  section("Candidates — CRUD");

  // POST missing fields → 400
  const noParty = await post(`/elections/${pendingAddr}/races/${raceId}/candidates`,
    { name: "Alice", number: 1 });
  assert("POST candidate missing party → 400", noParty.status === 400,
    `got ${noParty.status}: ${JSON.stringify(noParty.body)}`);

  // POST number = 0 → 400 (reserved for blank vote)
  const numZero = await post(`/elections/${pendingAddr}/races/${raceId}/candidates`,
    { name: "Alice", party: "A", number: 0 });
  assert("POST candidate number=0 (blank) → 400", numZero.status === 400,
    `got ${numZero.status}: ${JSON.stringify(numZero.body)}`);

  // POST number = 999 → 400 (reserved for null vote)
  const num999 = await post(`/elections/${pendingAddr}/races/${raceId}/candidates`,
    { name: "Alice", party: "A", number: 999 });
  assert("POST candidate number=999 (null) → 400", num999.status === 400,
    `got ${num999.status}: ${JSON.stringify(num999.body)}`);

  // POST valid → 201 returns txHash (candidateId inferred from receipt event)
  const c1 = await post(`/elections/${pendingAddr}/races/${raceId}/candidates`,
    { name: "Alice", party: "A", number: 42 });
  assert("POST candidate valid → 201 with txHash", (c1.status === 200 || c1.status === 201) && c1.body.txHash != null,
    `got ${c1.status}: ${JSON.stringify(c1.body)}`);
}

async function testVoterRegistration(pendingAddr, poseidon, F) {
  section("Voter Registration");

  // POST voters without admin key → 401
  const noAuth = await post(`/elections/${pendingAddr}/voters`,
    { hashes: ["1"], merkleRoot: "1" }, { "X-Admin-Key": "bad" });
  assert("POST voters without admin key → 401", noAuth.status === 401,
    `got ${noAuth.status}: ${JSON.stringify(noAuth.body)}`);

  // POST empty hashes → 400
  const empty = await post(`/elections/${pendingAddr}/voters`,
    { hashes: [], merkleRoot: "1" });
  assert("POST voters empty hashes → 400", empty.status === 400,
    `got ${empty.status}: ${JSON.stringify(empty.body)}`);

  // POST 17 hashes (exceeds max 16) → 400
  const tooMany = await post(`/elections/${pendingAddr}/voters`,
    { hashes: Array.from({length:17}, (_,i) => String(i+1)), merkleRoot: "1" });
  assert("POST voters 17 hashes (max 16) → 400", tooMany.status === 400,
    `got ${tooMany.status}: ${JSON.stringify(tooMany.body)}`);

  // POST non-numeric hash → 400
  const badHash = await post(`/elections/${pendingAddr}/voters`,
    { hashes: ["not-a-number"], merkleRoot: "1" });
  assert("POST voters non-numeric hash → 400", badHash.status === 400,
    `got ${badHash.status}: ${JSON.stringify(badHash.body)}`);

  // POST valid (exactly 16 hashes = full tree) → 200/201
  const hashes = Array.from({length: 16}, (_, i) => String(i + 1));
  const full16 = await post(`/elections/${pendingAddr}/voters`,
    { hashes, merkleRoot: "1" });
  assert("POST voters 16 hashes (max allowed) → 2xx", full16.status < 300,
    `got ${full16.status}: ${JSON.stringify(full16.body)}`);

  // GET voters → committed list
  const list = await get(`/elections/${pendingAddr}/voters`);
  assert("GET /voters → 200 array of commitments", list.status === 200 && Array.isArray(list.body),
    JSON.stringify(list.body));
}

async function testVoteSubmission(poseidon, F, setupData) {
  section("Vote Submission — guards 1-11");

  const { addr, raceId, electionId, tree } = setupData;
  const eid  = electionId;
  const rid  = BigInt(raceId);
  const cid  = 1n; // first candidate
  const ZEROS = new Array(24).fill("0");

  // Guard 1: missing/wrong body shape
  const badBody = await post(`/elections/${addr}/votes`, { raceId: "not-a-number" }, {});
  assert("G1: invalid body shape → 400", badBody.status === 400,
    `got ${badBody.status}: ${JSON.stringify(badBody.body)}`);

  // Guard 1: wrong pubSignals length
  const shortSigs = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: ["1","2","3"], proof: ZEROS }, {});
  assert("G1: pubSignals length != 6 → 400", shortSigs.status === 400,
    `got ${shortSigs.status}: ${JSON.stringify(shortSigs.body)}`);

  // Guard 1: wrong proof length
  const shortProof = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: ["1","1","1","1","1","1"], proof: ["0"] }, {});
  assert("G1: proof length != 24 → 400", shortProof.status === 400,
    `got ${shortProof.status}: ${JSON.stringify(shortProof.body)}`);

  // Guard 1: non-field-element in pubSignals
  const badField = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: ["not-a-number","1","1","1","1","1"], proof: ZEROS }, {});
  assert("G1: non-field pubSignal → 400", badField.status === 400,
    `got ${badField.status}: ${JSON.stringify(badField.body)}`);

  // Guard 1: negative number → 400
  const negNum = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: ["-1","1","1","1","1","1"], proof: ZEROS }, {});
  assert("G1: negative pubSignal → 400", negNum.status === 400,
    `got ${negNum.status}: ${JSON.stringify(negNum.body)}`);

  // Guard 2: election not open (FINISHED election)
  // We'll use an election in PENDING state for this
  const pendingElection = await post("/elections", { name: "Pending Election", description: "test" });
  const pendingAddr = pendingElection.body.address;
  const notOpen = await post(`/elections/${pendingAddr}/votes`,
    { raceId: 1, pubSignals: ["1","1","1","1","1","1"], proof: ZEROS }, {});
  assert("G2: vote on PENDING election → 4xx", notOpen.status >= 400 && notOpen.status < 500,
    `got ${notOpen.status}: ${JSON.stringify(notOpen.body)}`);

  // Guard 3: merkle root mismatch
  const wrongRoot = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: ["999","1","1",eid.toString(),rid.toString(),"0"], proof: ZEROS }, {});
  assert("G3: wrong merkle root → 400", wrongRoot.status === 400,
    `got ${wrongRoot.status}: ${JSON.stringify(wrongRoot.body)}`);

  // Guard 4: race_id mismatch (pubSignals[4] != raceId param)
  const raceMismatch = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: [tree.root, "1", "1", eid.toString(), "0", "0"], proof: ZEROS }, {});
  assert("G4: race_id mismatch → 400", raceMismatch.status === 400 && raceMismatch.body.code === "RACE_ID_MISMATCH",
    `got ${raceMismatch.status}: ${JSON.stringify(raceMismatch.body)}`);

  // Guard 5: raceId out of range
  const badRaceId = await post(`/elections/${addr}/votes`,
    { raceId: 999, pubSignals: [tree.root, "1", "1", eid.toString(), "999", "0"], proof: ZEROS }, {});
  assert("G5: raceId out of range → 400", badRaceId.status === 400 && badRaceId.body.code === "INVALID_RACE_ID",
    `got ${badRaceId.status}: ${JSON.stringify(badRaceId.body)}`);

  // Guard: election_id mismatch
  const wrongEid = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: [tree.root, "1", "1", "999", rid.toString(), "0"], proof: ZEROS }, {});
  assert("G: wrong election_id → 400", wrongEid.status === 400 && wrongEid.body.code === "INVALID_ELECTION_ID",
    `got ${wrongEid.status}: ${JSON.stringify(wrongEid.body)}`);

  // Guard 11: real proof → should get CONTRACT_REVERT (verifier rejects zeros on real verifier)
  // We'll just check that ALL guards above the proof check pass with correct values
  const correctSignals = [
    tree.root,
    "12345",         // fake nullifier (not yet used)
    cid.toString(),
    eid.toString(),
    rid.toString(),
    "0",
  ];
  const allGuardsPassed = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: correctSignals, proof: ZEROS }, {});
  assert("G9 pending check passes (fake nullifier, hits verifier)", 
    allGuardsPassed.status === 400 && allGuardsPassed.body.code === "CONTRACT_REVERT",
    `got ${allGuardsPassed.status}: ${JSON.stringify(allGuardsPassed.body)}`);
}

async function testRealVoteFlow(poseidon, F, setupData) {
  section("Real Vote Flow (ZK proof end-to-end)");

  const { addr, raceId, electionId, tree } = setupData;
  const eid = electionId;
  const rid = BigInt(raceId);

  // Generate a real proof for voter 0
  process.stdout.write("  Generating ZK proof for voter 0 (race 1, candidate 1)...\n");
  const input0 = mkProofInput(poseidon, F, tree, VOTER_IDS, 0, eid, rid, 1n);
  let proof0, sigs0;
  try {
    ({ proof: proof0, pubSignals: sigs0 } = generateProof(input0));
  } catch(e) {
    fail("ZK proof generation", e.message);
    return;
  }

  // First submission → 202
  const vote1 = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: sigs0, proof: proof0 }, {});
  assert("Valid ZK proof → 202 with txHash", vote1.status === 202 && vote1.body.txHash,
    `got ${vote1.status}: ${JSON.stringify(vote1.body)}`);
  const nullifier = vote1.body.nullifier;

  // Double submit same nullifier → contract revert (nullifier used)
  const vote1again = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: sigs0, proof: proof0 }, {});
  assert("Double-submit same proof → 4xx NULLIFIER_USED", 
    vote1again.status >= 400 && (vote1again.body.code === "NULLIFIER_USED" || vote1again.body.code === "CONTRACT_REVERT"),
    `got ${vote1again.status}: ${JSON.stringify(vote1again.body)}`);

  // Vote receipt → 200 confirmed
  const receipt = await get(`/elections/${addr}/votes/${nullifier}`);
  assert("GET vote receipt → 200 confirmed/submitted", 
    receipt.status === 200 && (receipt.body.status === "confirmed" || receipt.body.status === "submitted"),
    `got ${receipt.status}: ${JSON.stringify(receipt.body)}`);

  // GET non-existent nullifier → 200 not_found
  const notFoundReceipt = await get(`/elections/${addr}/votes/99999999999`);
  assert("GET non-existent nullifier → 200 not_found",
    notFoundReceipt.status === 200 && notFoundReceipt.body.status === "not_found",
    `got ${notFoundReceipt.status}: ${JSON.stringify(notFoundReceipt.body)}`);

  // Vote from a second voter on same race → should succeed (different nullifier)
  process.stdout.write("  Generating ZK proof for voter 1 (same race, different voter)...\n");
  const input1 = mkProofInput(poseidon, F, tree, VOTER_IDS, 1, eid, rid, 1n);
  let proof1, sigs1;
  try {
    ({ proof: proof1, pubSignals: sigs1 } = generateProof(input1));
  } catch(e) {
    fail("ZK proof generation voter 1", e.message);
    return;
  }
  const vote2 = await post(`/elections/${addr}/votes`,
    { raceId, pubSignals: sigs1, proof: proof1 }, {});
  assert("Second voter on same race → 202", vote2.status === 202 && vote2.body.txHash,
    `got ${vote2.status}: ${JSON.stringify(vote2.body)}`);

  return { addr, nullifier };
}

async function testVerifyProof(poseidon, F, setupData) {
  section("Verify-Proof dry-run");

  const { addr, raceId, electionId, tree } = setupData;
  const eid = electionId;
  const rid = BigInt(raceId);

  // verify-proof runs off-chain guards only (guards 3-8) — does NOT call on-chain verifier
  // So correct signals with zero proof → 200 valid (verifier not called)
  const dryRunValid = await post(`/elections/${addr}/verify-proof`, {
    raceId,
    pubSignals: [tree.root, "54321", "1", eid.toString(), rid.toString(), "0"],
    proof: new Array(24).fill("0"),
  }, {});
  assert("verify-proof with valid signals → 200 valid (off-chain only)",
    dryRunValid.status === 200 && dryRunValid.body.valid === true,
    `got ${dryRunValid.status}: ${JSON.stringify(dryRunValid.body)}`);

  // verify-proof with wrong merkle root → 200 valid (root is NOT checked off-chain;
  // it's validated by the contract on-chain only)
  const dryRunBadRoot = await post(`/elections/${addr}/verify-proof`, {
    raceId,
    pubSignals: ["9999", "54321", "1", eid.toString(), rid.toString(), "0"],
    proof: new Array(24).fill("0"),
  }, {});
  assert("verify-proof with wrong root → 200 (root checked on-chain only)",
    dryRunBadRoot.status === 200 && dryRunBadRoot.body.valid === true,
    `got ${dryRunBadRoot.status}: ${JSON.stringify(dryRunBadRoot.body)}`);

  // verify-proof with wrong election_id → 400
  const dryRunBadEid = await post(`/elections/${addr}/verify-proof`, {
    raceId,
    pubSignals: [tree.root, "54321", "1", "999", rid.toString(), "0"],
    proof: new Array(24).fill("0"),
  }, {});
  assert("verify-proof with wrong election_id → 400",
    dryRunBadEid.status === 400 && dryRunBadEid.body.code === "INVALID_ELECTION_ID",
    `got ${dryRunBadEid.status}: ${JSON.stringify(dryRunBadEid.body)}`);
}

async function testFinishedElection(addr) {
  section("Election state: FINISHED");

  // Close election
  const closed = await patch(`/elections/${addr}`, { state: "FINISHED" });
  assert("PATCH FINISHED on OPEN → 200", closed.status === 200,
    `got ${closed.status}: ${JSON.stringify(closed.body)}`);

  // Re-opening FINISHED → 4xx
  const reopen = await patch(`/elections/${addr}`, { state: "OPEN" });
  assert("PATCH OPEN on FINISHED → 4xx", reopen.status >= 400 && reopen.status < 500,
    `got ${reopen.status}: ${JSON.stringify(reopen.body)}`);

  // Vote on FINISHED → 4xx
  const lateVote = await post(`/elections/${addr}/votes`,
    { raceId: 1, pubSignals: ["1","1","1","1","1","1"], proof: new Array(24).fill("0") }, {});
  assert("Vote on FINISHED election → 4xx", lateVote.status >= 400 && lateVote.status < 500,
    `got ${lateVote.status}: ${JSON.stringify(lateVote.body)}`);
}

async function testAudit(addr) {
  section("Audit endpoints");

  const rdv = await get(`/elections/${addr}/audit/rdv`);
  assert("GET /audit/rdv → 200 type=RDV", 
    rdv.status === 200 && rdv.body.type === "RDV" && typeof rdv.body.sha256 === "string",
    `got ${rdv.status}: ${JSON.stringify(rdv.body)}`);

  assert("RDV has voteCount >= 2 (from real vote flow)",
    rdv.body.voteCount >= 2,
    `voteCount=${rdv.body.voteCount}`);

  assert("RDV sha256 is 64 hex chars",
    /^[0-9a-f]{64}$/.test(rdv.body.sha256),
    `sha256=${rdv.body.sha256}`);

  const bu = await get(`/elections/${addr}/audit/bu`);
  assert("GET /audit/bu → 200", bu.status === 200, `got ${bu.status}: ${JSON.stringify(bu.body)}`);

  const zeresima = await get(`/elections/${addr}/audit/zeresima`);
  // Zeresima only works on PENDING, election is now FINISHED
  assert("GET /audit/zeresima on FINISHED → 4xx",
    zeresima.status >= 400,
    `got ${zeresima.status}: ${JSON.stringify(zeresima.body)}`);
}

async function testConcurrent(poseidon, F) {
  section("Concurrent submissions (NONCE race condition)");

  // Create and setup a fresh election
  const setup = await setupElection(poseidon, F);
  const { addr, raceId, electionId, tree } = setup;
  const eid = electionId;
  const rid = BigInt(raceId);

  // Generate proofs for voters 2, 3, 4 simultaneously
  process.stdout.write("  Generating 3 ZK proofs concurrently...\n");
  let proofs;
  try {
    proofs = [2, 3, 4].map(i => {
      const input = mkProofInput(poseidon, F, tree, VOTER_IDS, i, eid, rid, 1n);
      return { payload: generateProof(input), voterIdx: i };
    });
  } catch(e) {
    fail("Concurrent proof generation", e.message);
    return;
  }

  // Submit all 3 simultaneously
  const results = await Promise.all(proofs.map(({ payload }) =>
    post(`/elections/${addr}/votes`, {
      raceId,
      pubSignals: payload.pubSignals,
      proof: payload.proof,
    }, {})
  ));

  const successes = results.filter(r => r.status === 202).length;
  const failures_c = results.filter(r => r.status >= 400).length;

  assert(`Concurrent: all 3 votes accepted (NonceManager)`, successes === 3,
    `successes=${successes}, failures=${failures_c}. Responses: ${JSON.stringify(results.map(r => ({status:r.status, code:r.body.code})))}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(`\n\x1b[1mEdge Case Test Suite — ${API_BASE}\x1b[0m\n`);
  process.stdout.write(`FILTER: ${FILTER ?? "all"}\n`);

  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const shouldRun = (name) => !FILTER || name.toLowerCase().includes(FILTER.toLowerCase());

  try {
    if (shouldRun("health"))    await testHealth();

    let pendingAddr;
    if (shouldRun("elections")) pendingAddr = await testElections(poseidon, F);
    else {
      const r = await post("/elections", { name: "X", description: "Y" });
      pendingAddr = r.body.address;
    }

    let raceId;
    if (shouldRun("races"))     raceId = await testRaces(pendingAddr);
    if (shouldRun("candidates") && raceId) await testCandidates(pendingAddr, raceId);
    if (shouldRun("voters"))    await testVoterRegistration(pendingAddr, poseidon, F);

    // Main test election: fresh setup with real ZK proofs
    process.stdout.write("\n\x1b[2mSetting up test election with real Poseidon voters...\x1b[0m\n");
    const setupData = await setupElection(poseidon, F);

    if (shouldRun("votes"))     await testVoteSubmission(poseidon, F, setupData);
    let voteResult;
    if (shouldRun("real"))      voteResult = await testRealVoteFlow(poseidon, F, setupData);
    if (shouldRun("verify"))    await testVerifyProof(poseidon, F, setupData);
    if (shouldRun("finished") && voteResult) await testFinishedElection(voteResult.addr);
    if (shouldRun("audit") && voteResult)    await testAudit(voteResult.addr);
    if (shouldRun("concurrent")) await testConcurrent(poseidon, F);

  } catch (err) {
    process.stdout.write(`\n\x1b[31mFATAL: ${err.message}\x1b[0m\n`);
    process.exit(1);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  process.stdout.write(`\n${"─".repeat(60)}\n`);
  process.stdout.write(`\x1b[32m✓ ${passed} passed\x1b[0m  `);
  if (failed > 0) process.stdout.write(`\x1b[31m✗ ${failed} failed\x1b[0m  `);
  if (skipped > 0) process.stdout.write(`\x1b[33m- ${skipped} skipped\x1b[0m`);
  process.stdout.write("\n");

  if (failures.length > 0) {
    process.stdout.write("\nFailed tests:\n");
    for (const f of failures) {
      process.stdout.write(`  \x1b[31m✗\x1b[0m ${f.name}\n    ${f.detail}\n`);
    }
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
