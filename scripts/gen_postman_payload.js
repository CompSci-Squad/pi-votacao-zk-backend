#!/usr/bin/env node
/**
 * gen_postman_payload.js
 *
 * Reads the current on-chain election state and generates ready-to-use
 * Postman request payloads for POST /elections/:addr/votes.
 *
 * Two modes:
 *
 *   --mock   (default when election uses MockVerifier / voterMerkleRoot is a
 *             small number like "1")
 *             Builds correct pubSignals (real Poseidon nullifier) + 24-zero
 *             proof.  MockVerifier accepts any proof, so this reaches the chain.
 *
 *   --real   Full setup: creates a fresh election with proper Poseidon
 *             commitments, computes the real Merkle root, opens the election,
 *             then generates a genuine ZK proof via snarkjs.
 *             Requires: ADMIN_KEY in env, snarkjs artifacts present.
 *
 * Usage:
 *   node scripts/gen_postman_payload.js
 *   node scripts/gen_postman_payload.js --mock --election 0xAbc... --voter-index 0 --race-id 1 --candidate-id 1
 *   node scripts/gen_postman_payload.js --real
 *
 * Output: JSON object(s) ready to paste into Postman body.
 */

"use strict";

const { buildPoseidon } = require("circomlibjs");
const https = require("https");
const http  = require("http");
const path  = require("path");
const { execSync } = require("child_process");
const { writeFileSync, unlinkSync, existsSync } = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE   = process.env.API_BASE ?? "http://localhost:3000";
const ADMIN_KEY  = process.env.ADMIN_KEY ?? "dev-admin-key";
const ZKEY_PATH  = path.resolve(__dirname, "../../pi-votacao-zk-circuits/artifacts/voter_proof.zkey");
const WASM_PATH  = path.resolve(__dirname, "../../pi-votacao-zk-circuits/artifacts/voter_proof.wasm");
const SNARKJS    = path.resolve(__dirname, "../../pi-votacao-zk-circuits/node_modules/.bin/snarkjs");

const TREE_DEPTH = 4;
const TREE_SIZE  = 1 << TREE_DEPTH; // 16

// Test voter IDs (CPF-like numbers)
const TEST_VOTER_IDS = [
  12345678901n, 98765432100n, 11122233344n, 55566677788n,
  99900011122n, 33344455566n, 77788899900n, 22233344455n,
  66677788899n, 44455566677n, 10203040506n, 60708090100n,
  11213141516n, 61718191011n, 21314151617n,
];

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag  = (f) => args.includes(f);
const opt   = (f, def) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : def; };

const MODE         = flag("--real") ? "real" : "mock";
const VOTER_INDEX  = parseInt(opt("--voter-index", "0"), 10);
const RACE_ID      = BigInt(opt("--race-id", "1"));
const CANDIDATE_ID = BigInt(opt("--candidate-id", "1"));
const PICK_INDEX   = BigInt(opt("--pick-index", "0"));
const ELECTION_OPT = opt("--election", null);

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function apiFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const lib = url.protocol === "https:" ? https : http;
    const body = opts.body ? JSON.stringify(opts.body) : undefined;
    const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
    if (body) headers["Content-Length"] = Buffer.byteLength(body);

    const req = lib.request(url, { method: opts.method ?? "GET", headers }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Poseidon / Merkle helpers ─────────────────────────────────────────────────

function buildTree(poseidon, F, leafCommitments) {
  const rawLeaves = new Array(TREE_SIZE).fill(null).map(() => F.zero);
  for (let i = 0; i < leafCommitments.length && i < TREE_SIZE; i++) {
    rawLeaves[i] = F.e(leafCommitments[i]);
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

function inclusionProof(levels, F, leafIndex) {
  const pathElements = [], pathIndices = [];
  let cur = leafIndex;
  for (let d = 0; d < TREE_DEPTH; d++) {
    const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
    pathElements.push(F.toString(levels[d][sib]));
    pathIndices.push(cur % 2);
    cur = Math.floor(cur / 2);
  }
  return { pathElements, pathIndices };
}

// ── ZK proof generation (real mode) ──────────────────────────────────────────

function generateProof(circuitInput) {
  if (!existsSync(ZKEY_PATH)) throw new Error(`zkey not found: ${ZKEY_PATH}`);
  if (!existsSync(WASM_PATH)) throw new Error(`wasm not found: ${WASM_PATH}`);
  if (!existsSync(SNARKJS))   throw new Error(`snarkjs not found: ${SNARKJS}`);

  const tmpInput   = path.join(__dirname, "_tmp_input.json");
  const tmpWitness = path.join(__dirname, "_tmp_witness.wtns");
  const tmpProof   = path.join(__dirname, "_tmp_proof.json");
  const tmpPublic  = path.join(__dirname, "_tmp_public.json");

  try {
    writeFileSync(tmpInput, JSON.stringify(circuitInput));
    execSync(`${SNARKJS} wtns calculate ${WASM_PATH} ${tmpInput} ${tmpWitness}`, { stdio: "pipe" });
    execSync(`${SNARKJS} plonk prove ${ZKEY_PATH} ${tmpWitness} ${tmpProof} ${tmpPublic}`, { stdio: "pipe" });

    const p   = JSON.parse(require("fs").readFileSync(tmpProof, "utf8"));
    const pub = JSON.parse(require("fs").readFileSync(tmpPublic, "utf8"));

    const proof = [
      p.A[0],p.A[1], p.B[0],p.B[1], p.C[0],p.C[1],
      p.Z[0],p.Z[1], p.T1[0],p.T1[1], p.T2[0],p.T2[1],
      p.T3[0],p.T3[1], p.Wxi[0],p.Wxi[1], p.Wxiw[0],p.Wxiw[1],
      p.eval_a, p.eval_b, p.eval_c, p.eval_s1, p.eval_s2, p.eval_zw,
    ];
    return { proof, pubSignals: pub };
  } finally {
    for (const f of [tmpInput, tmpWitness, tmpProof, tmpPublic]) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  }
}

// ── Mock mode ─────────────────────────────────────────────────────────────────

async function mockMode(poseidon, F, election, voterIndex, raceId, candidateId, pickIndex) {
  const onChainRoot  = election.voterMerkleRoot;
  const electionId   = BigInt(election.currentElectionId);
  const voterId      = TEST_VOTER_IDS[voterIndex];

  // Compute commitment = Poseidon(voter_id) — for reference
  const commitment = F.toString(poseidon([voterId]));

  // Compute nullifier = Poseidon(voter_id, election_id, race_id, pick_index)
  const nullifier = F.toString(poseidon([voterId, electionId, raceId, pickIndex]));

  const pubSignals = [
    onChainRoot,            // [0] merkle_root   — must match on-chain
    nullifier,              // [1] nullifier_hash
    candidateId.toString(), // [2] candidate_id
    electionId.toString(),  // [3] election_id
    raceId.toString(),      // [4] race_id
    pickIndex.toString(),   // [5] pick_index
  ];

  // MockVerifier accepts any 24-element proof
  const proof = new Array(24).fill("0");

  return { pubSignals, proof, commitment, voterId: voterId.toString(), nullifier };
}

// ── Real mode ─────────────────────────────────────────────────────────────────

async function realMode(poseidon, F, voterIndex, raceId, candidateId, pickIndex) {
  process.stderr.write("\n[real mode] Creating fresh election via admin API...\n");

  const adminHeaders = { "X-Admin-Key": ADMIN_KEY };

  // 1. Create election
  const created = await apiFetch("/elections", {
    method: "POST", headers: adminHeaders,
    body: { name: "Test Election", description: "Generated by gen_postman_payload.js" },
  });
  if (created.status !== 201) throw new Error(`Create election failed: ${JSON.stringify(created.body)}`);
  const addr = created.body.address;
  process.stderr.write(`   Election: ${addr}\n`);

  // 2. Add race 1 (name it so it's visible)
  const raceRes = await apiFetch(`/elections/${addr}/races`, {
    method: "POST", headers: adminHeaders,
    body: { name: "Test Race" },
  });
  if (raceRes.status !== 200 && raceRes.status !== 201)
    throw new Error(`Add race failed: ${JSON.stringify(raceRes.body)}`);
  const actualRaceId = BigInt(raceRes.body?.raceId ?? 1);
  process.stderr.write(`   Race: ${actualRaceId}\n`);

  // 3. Add a candidate to that race
  const candRes = await apiFetch(`/elections/${addr}/races/${actualRaceId}/candidates`, {
    method: "POST", headers: adminHeaders,
    body: { name: "Test Candidate", party: "TC", number: 99 },
  });
  if (candRes.status !== 200 && candRes.status !== 201)
    throw new Error(`Add candidate failed: ${JSON.stringify(candRes.body)}`);
  const actualCandidateId = BigInt(candRes.body?.id ?? candRes.body?.candidateId ?? 1);
  process.stderr.write(`   Candidate: ${actualCandidateId}\n`);

  // 4. Compute Poseidon commitments and Merkle tree
  const voterIds = TEST_VOTER_IDS.slice(0, 8);
  const leafCommitments = voterIds.map((id) => BigInt(F.toString(poseidon([id]))));
  const tree = buildTree(poseidon, F, leafCommitments);
  process.stderr.write(`   Merkle root: ${tree.root}\n`);

  // 5. Register voters + Merkle root
  const reg = await apiFetch(`/elections/${addr}/voters`, {
    method: "POST", headers: adminHeaders,
    body: { hashes: leafCommitments.map(String), merkleRoot: tree.root },
  });
  if (reg.status !== 200 && reg.status !== 201)
    throw new Error(`Register voters failed: ${JSON.stringify(reg.body)}`);

  // 6. Open election
  const opened = await apiFetch(`/elections/${addr}`, {
    method: "PATCH", headers: adminHeaders,
    body: { state: "OPEN" },
  });
  if (opened.status !== 200) throw new Error(`Open election failed: ${JSON.stringify(opened.body)}`);
  process.stderr.write(`   Election opened.\n`);

  // 7. Build circuit input
  const voterId    = voterIds[voterIndex];
  const electionId = BigInt((await apiFetch(`/elections/${addr}`)).body.currentElectionId);
  const { pathElements, pathIndices } = inclusionProof(tree.levels, F, voterIndex);
  const nullifier  = F.toString(poseidon([voterId, electionId, actualRaceId, pickIndex]));

  const circuitInput = {
    voter_id:            voterId.toString(),
    merkle_root:         tree.root,
    merkle_path:         pathElements,
    merkle_path_indices: pathIndices,
    nullifier_hash:      nullifier,
    candidate_id:        actualCandidateId.toString(),
    election_id:         electionId.toString(),
    race_id:             actualRaceId.toString(),
    pick_index:          pickIndex.toString(),
  };

  process.stderr.write(`\n[real mode] Generating ZK proof (this takes ~10-30s)...\n`);
  const { proof, pubSignals } = generateProof(circuitInput);

  return { addr, pubSignals, proof, voterId: voterId.toString(), nullifier,
           raceId: actualRaceId, candidateId: actualCandidateId };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  let electionAddr, result;

  if (MODE === "real") {
    result = await realMode(poseidon, F, VOTER_INDEX, RACE_ID, CANDIDATE_ID, PICK_INDEX);
    electionAddr = result.addr;
  } else {
    // Mock mode — read existing election
    const elections = (await apiFetch("/elections")).body;
    if (!Array.isArray(elections) || elections.length === 0) {
      throw new Error("No elections found. Run setup_dev.js first.");
    }
    const election = ELECTION_OPT
      ? elections.find((e) => e.address.toLowerCase() === ELECTION_OPT.toLowerCase())
      : elections[0];
    if (!election) throw new Error(`Election not found: ${ELECTION_OPT}`);

    electionAddr = election.address;

    // Fetch full details (includes currentElectionId, voterMerkleRoot, races)
    const detail = (await apiFetch(`/elections/${electionAddr}`)).body;

    process.stderr.write(`\n--- Election ---\n`);
    process.stderr.write(`address:         ${detail.address}\n`);
    process.stderr.write(`state:           ${detail.stateLabel}\n`);
    process.stderr.write(`currentElection: ${detail.currentElectionId}\n`);
    process.stderr.write(`voterMerkleRoot: ${detail.voterMerkleRoot}\n`);
    process.stderr.write(`races:           ${JSON.stringify(detail.races?.map(r => ({ raceId: r.raceId, name: r.name, candidates: r.candidates?.map(c => `${c.id}:${c.name}`) })))}\n`);

    // Resolve race/candidate defaults from actual on-chain data
    const races = detail.races ?? [];
    const race = races.find(r => BigInt(r.raceId) === RACE_ID) ?? races[0];
    const actualRaceId = race ? BigInt(race.raceId) : RACE_ID;
    const actualCandidateId = race?.candidates?.[0]?.id
      ? BigInt(race.candidates[0].id)
      : CANDIDATE_ID;

    result = await mockMode(poseidon, F, detail, VOTER_INDEX, actualRaceId, actualCandidateId, PICK_INDEX);
    result.electionAddr = electionAddr;

    process.stderr.write(`\n--- Voter ---\n`);
    process.stderr.write(`voter_id (secret): ${result.voterId}\n`);
    process.stderr.write(`commitment (Poseidon(voter_id)): ${result.commitment}\n`);
    process.stderr.write(`nullifier:         ${result.nullifier}\n`);
    process.stderr.write(`\nNOTE: proof is 24 zeros — works only with MockVerifier.\n`);
    process.stderr.write(`      Use --real to generate a genuine ZK proof.\n\n`);
  }

  // ── Output Postman payload ────────────────────────────────────────────────
  const payload = {
    raceId: Number(result.raceId ?? RACE_ID),
    pubSignals: result.pubSignals,
    proof: result.proof,
  };

  process.stderr.write(`\n--- POST ${API_BASE}/elections/${electionAddr}/votes ---\n\n`);
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");

  // Also print all needed Postman vars
  process.stderr.write(`\n--- Postman variables ---\n`);
  process.stderr.write(`baseUrl:       ${API_BASE}\n`);
  process.stderr.write(`electionAddr:  ${electionAddr}\n`);
  process.stderr.write(`\n--- Vote receipt (after submission) ---\n`);
  process.stderr.write(`GET ${API_BASE}/elections/${electionAddr}/votes/${result.nullifier}\n`);

  // Generate multiple voters so you can test sequential submissions
  if (flag("--all-voters")) {
    process.stderr.write(`\n--- All voters (mock payloads for each) ---\n`);
    const detail = (await apiFetch(`/elections/${electionAddr}`)).body;
    const races  = detail.races ?? [];
    const race   = races.find(r => BigInt(r.raceId) === RACE_ID) ?? races[0];
    const aRaceId = race ? BigInt(race.raceId) : RACE_ID;
    const aCandId = race?.candidates?.[0]?.id ? BigInt(race.candidates[0].id) : CANDIDATE_ID;

    const all = [];
    for (let i = 0; i < TEST_VOTER_IDS.length; i++) {
      const r = await mockMode(poseidon, F, detail, i, aRaceId, aCandId, PICK_INDEX);
      all.push({ voterIndex: i, voterId: r.voterId, ...{ raceId: Number(aRaceId), pubSignals: r.pubSignals, proof: r.proof } });
    }
    process.stderr.write(JSON.stringify(all, null, 2) + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
