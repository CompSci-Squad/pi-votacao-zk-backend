# Voter Algorithm — Complete Client-Side Reference

This document describes **every computation the front-end must perform** to register
voters and cast a vote, from raw CPF to on-chain ZK proof submission.

---

## Table of Contents

1. [Overview](#overview)
2. [Dependencies](#dependencies)
3. [Phase 1 — Admin: Register Voters](#phase-1--admin-register-voters)
   - [Step 1.1 — Compute voter commitments](#step-11--compute-voter-commitments)
   - [Step 1.2 — Build the Merkle tree](#step-12--build-the-merkle-tree)
   - [Step 1.3 — POST /elections/:addr/voters](#step-13--post-electionsaddrvoters)
4. [Phase 2 — Voter: Cast a Vote](#phase-2--voter-cast-a-vote)
   - [Step 2.1 — Get the Merkle inclusion proof](#step-21--get-the-merkle-inclusion-proof)
   - [Step 2.2 — Compute the nullifier hash](#step-22--compute-the-nullifier-hash)
   - [Step 2.3 — Assemble the ZK circuit inputs](#step-23--assemble-the-zk-circuit-inputs)
   - [Step 2.4 — Generate the PLONK proof](#step-24--generate-the-plonk-proof)
   - [Step 2.5 — Format proof for the API](#step-25--format-proof-for-the-api)
   - [Step 2.6 — POST /elections/:addr/votes](#step-26--post-electionsaddrVotes)
5. [Field Reference](#field-reference)
   - [Circuit private inputs](#circuit-private-inputs)
   - [Circuit public inputs (pubSignals)](#circuit-public-inputs-pubsignals)
   - [Proof array](#proof-array)
6. [Security guarantees](#security-guarantees)
7. [Full worked example](#full-worked-example)
8. [Common errors](#common-errors)

---

## Overview

The system uses a **PLONK zero-knowledge proof** to let a voter prove:

1. **Authorization** — their CPF hash is a leaf in the on-chain Merkle voter tree.
2. **Integrity** — the leaf hash was computed correctly inside the circuit.
3. **Uniqueness** — the `nullifier_hash` has never been seen before (no double voting).
4. **Binding** — the proof is tied to a specific election, race, and pick index so a
   relayer cannot reuse it for a different race.

The **CPF never leaves the voter's device**. Only the ZK proof and public signals are
sent to the backend.

```
Voter's browser
  │
  ├─ CPF (secret)
  │    └─→ Poseidon(CPF)  ──────────────────────────► commitment (registered on-chain)
  │
  ├─ nullifier = Poseidon(CPF, electionId, raceId, pickIndex)  ──► submitted with proof
  │
  └─ ZK proof  ────────────────────────────────────────────────► backend → contract
```

---

## Dependencies

Install these in the front-end project:

```bash
npm install circomlibjs snarkjs
```

| Package | Purpose |
|---|---|
| `circomlibjs` | `buildPoseidon()` — Poseidon hash over BN128 field |
| `snarkjs` | `groth16` / `plonk` proof generation in the browser |

The circuit artifacts (`.wasm` + `.zkey`) must be served as static files. They are
already compiled and live in `pi-votacao-zk-circuits/artifacts/`:

```
artifacts/
  voter_proof.zkey        ← proving key (used by snarkjs to generate proof)
  verification_key.json   ← verifying key (used to verify locally before submission)
build/
  test_circuit/
    voter_proof_js/
      voter_proof.wasm    ← compiled circuit (used by snarkjs in the browser)
```

---

## Phase 1 — Admin: Register Voters

This phase is performed **once per election**, by an admin, before the election opens.

### Step 1.1 — Compute voter commitments

For each voter, compute their **commitment** = `Poseidon(CPF_as_integer)`.

The CPF must be treated as a plain integer (no formatting, no dashes).

```js
const { buildPoseidon } = require("circomlibjs");

async function computeCommitments(cpfList) {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  return cpfList.map((cpf) => {
    const cpfBigInt = BigInt(cpf); // e.g. "12345678901" → 12345678901n
    const hashField = poseidon([cpfBigInt]);
    return F.toString(hashField); // decimal string
  });
}

// Example:
const commitments = await computeCommitments([
  "12345678901",
  "98765432100",
]);

// commitments[0] = "14751853109234085702934576823948572039485720394857203948572039485"
// commitments[1] = "21456023948572039485720394857203948572039485720394857203948572039"
```

> **Why Poseidon?**  
> SHA-256 is very expensive inside a ZK circuit. Poseidon is an algebraic hash
> function designed for BN128 — it produces a ~77-digit decimal number that fits
> natively in the field. The circuit re-derives this value internally and checks it
> against the Merkle tree leaf.

### Step 1.2 — Build the Merkle tree

The tree always has exactly **16 leaves** (depth 4). Empty slots are padded with
`F.zero` (`"0"`). The root must be computed with the same padding the backend uses,
otherwise the ZK proof will fail.

```js
async function buildMerkleTree(commitments, poseidon, F) {
  const DEPTH = 4;
  const SIZE  = 1 << DEPTH; // 16

  // Convert decimal strings back to field elements
  const rawLeaves = new Array(SIZE).fill(F.zero);
  commitments.forEach((c, i) => {
    rawLeaves[i] = F.e(BigInt(c));
  });

  // Build level-by-level (level 0 = leaves, level 4 = root)
  const levels = [rawLeaves];
  for (let d = 0; d < DEPTH; d++) {
    const prev = levels[d];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(poseidon([prev[i], prev[i + 1]]));
    }
    levels.push(next);
  }

  const root = F.toString(levels[DEPTH][0]);
  return { levels, root };
}

// Example with 2 voters (14 zero-padded slots):
const { levels, root } = await buildMerkleTree(commitments, poseidon, F);
// root = "9823041857203948572039485720394857203948572039485720394857203948"
```

#### Tree structure (depth 4, 2 voters)

```
                              ROOT
                   ┌──────────┴──────────┐
                  H01                   H(0,0)
            ┌─────┴─────┐           ┌───┴───┐
           H(0,1)      H(0,0)     H(0,0)  H(0,0)
           ┌─┴─┐       ┌─┴─┐
       leaf0  leaf1  zero  zero  ...   (12 more zeros)
  Poseidon   Poseidon
  (cpf_1)    (cpf_2)
```

### Step 1.3 — POST /elections/:addr/voters

Send the commitments and the Merkle root to the backend.  
Requires the admin key header.

```http
POST /elections/0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512/voters
x-admin-key: dev-admin-secret
Content-Type: application/json

{
  "hashes": [
    "14751853109234085702934576823948572039485720394857203948572039485",
    "21456023948572039485720394857203948572039485720394857203948572039"
  ],
  "merkleRoot": "9823041857203948572039485720394857203948572039485720394857203948"
}
```

**Rules:**
- `hashes`: 1–16 items, each a decimal string (no leading zeros, no hex).
- `merkleRoot`: decimal string, computed over all 16 leaves (zero-padded).
- The backend calls `registerVoterHashes` then `setMerkleRoot` as two separate
  on-chain transactions, in that order (contract enforces the order).

**Response 201:**
```json
{
  "hashes": { "transactionHash": "0xabc...def", "blockNumber": 7 },
  "merkleRoot": { "transactionHash": "0x123...456", "blockNumber": 8 }
}
```

---

## Phase 2 — Voter: Cast a Vote

This phase runs entirely in the **voter's browser**. The CPF never leaves the device.

### Step 2.1 — Get the Merkle inclusion proof

Call the API to get the voter's Merkle proof. The `commitment` is `Poseidon(CPF)`,
computed locally.

```http
GET /elections/0xe7f1.../voters/14751853109234085702934576823948572039485720394857203948572039485
```

**Response:**
```json
{
  "included": true,
  "leafIndex": 0,
  "pathElements": [
    "21456023948572039485720394857203948572039485720394857203948572039",
    "14763215145315200506921711489642608356394854266165572616578112107564877678998",
    "14693904821945502268578313651525098196765636411922213115469821563817117273617",
    "46679304678861853625823895076274446962581501223592478486690392336922497954"
  ],
  "pathIndices": [0, 0, 0, 0],
  "root": "55611993240970768952087494670654066999148413726872304615847127328622947368"
}
```

> If `included: false` the voter is not registered. Stop here and show an error.

### Step 2.2 — Compute the nullifier hash

The nullifier **prevents double voting**. It is deterministic for the tuple
`(voter_id, election_id, race_id, pick_index)`, so:

- Voting in **race 1** and **race 2** produces two different nullifiers → both allowed.
- Voting in **race 1** twice produces the same nullifier → second vote rejected.

```js
// Inputs needed:
//   voterId    = CPF as BigInt
//   electionId = from GET /elections/:addr (the on-chain numeric ID)
//   raceId     = which race the voter is voting in (e.g. 1 for President)
//   pickIndex  = 0 for single-pick races; 0..maxPicks-1 for multi-pick races

function computeNullifier(poseidon, F, voterId, electionId, raceId, pickIndex) {
  const h = poseidon([
    BigInt(voterId),
    BigInt(electionId),
    BigInt(raceId),
    BigInt(pickIndex),
  ]);
  return F.toString(h); // decimal string
}

// Example:
// voterId    = 12345678901n
// electionId = 1n  (from contract)
// raceId     = 1n  (President)
// pickIndex  = 0n  (first and only pick)
const nullifierHash = computeNullifier(poseidon, F,
  12345678901n, 1n, 1n, 0n
);
// nullifierHash = "7834029384750293847502938475029384750293847502938475029384750293"
```

### Step 2.3 — Assemble the ZK circuit inputs

The circuit takes **private** and **public** inputs. The private inputs stay in RAM and
are never transmitted. The public inputs become `pubSignals` in the API call.

```js
const circuitInput = {
  // ── PRIVATE (never transmitted) ──────────────────────────────
  voter_id:             "12345678901",          // CPF as decimal string
  merkle_path:          pathElements,           // from Step 2.1 (array of 4 strings)
  merkle_path_indices:  pathIndices,            // from Step 2.1 (array of 4 ints)

  // ── PUBLIC (become pubSignals) ────────────────────────────────
  merkle_root:          root,                   // from Step 2.1 (or from GET /elections)
  nullifier_hash:       nullifierHash,          // from Step 2.2
  candidate_id:         "42",                   // candidate number (0=blank, 999=null)
  election_id:          "1",                    // from GET /elections/:addr
  race_id:              "1",                    // which race
  pick_index:           "0",                    // 0 for single-pick
};
```

**pubSignals canonical order** (must match contract `IVerifier.sol`):

| Index | Field | Example |
|---|---|---|
| `[0]` | `merkle_root` | `"55611993240..."` |
| `[1]` | `nullifier_hash` | `"78340293847..."` |
| `[2]` | `candidate_id` | `"42"` |
| `[3]` | `election_id` | `"1"` |
| `[4]` | `race_id` | `"1"` |
| `[5]` | `pick_index` | `"0"` |

### Step 2.4 — Generate the PLONK proof

This is the expensive step (~1–5 seconds in the browser).

```js
const snarkjs = require("snarkjs");

// Load artifacts (served as static files from your CDN/server)
const wasmPath = "/circuits/voter_proof.wasm";
const zkeyPath = "/circuits/voter_proof.zkey";

const { proof, publicSignals } = await snarkjs.plonk.fullProve(
  circuitInput,
  wasmPath,
  zkeyPath,
);

// proof         → object with curve points (a, b, c, z, t1, t2, t3, wxi, wxiw)
// publicSignals → array of 6 decimal strings — same order as the table above
```

> `publicSignals` output by snarkjs equals `[merkle_root, nullifier_hash,
> candidate_id, election_id, race_id, pick_index]` — exactly `pubSignals` in the API.

### Step 2.5 — Format proof for the API

The backend expects the proof as **a flat array of 24 decimal strings**.
snarkjs returns an object with curve points. Use `exportSolidityCallData` to flatten it:

```js
const calldata = await snarkjs.plonk.exportSolidityCallData(proof, publicSignals);
// calldata is a string like:
// "["123...","456...", ... (24 proof values) ...],["sig0","sig1",...(6 pubSignals)]"

// Parse it:
const parsed = JSON.parse("[" + calldata + "]");
const proofArray     = parsed[0]; // 24 strings
const pubSignalArray = parsed[1]; // 6 strings
```

Alternatively, flatten the proof object manually:

```js
function flattenPlonkProof(proof) {
  // PLONK proof has 24 scalar elements in this order (snarkjs convention):
  return [
    proof.A[0], proof.A[1],
    proof.B[0], proof.B[1],
    proof.C[0], proof.C[1],
    proof.Z[0], proof.Z[1],
    proof.T1[0], proof.T1[1],
    proof.T2[0], proof.T2[1],
    proof.T3[0], proof.T3[1],
    proof.Wxi[0], proof.Wxi[1],
    proof.Wxiw[0], proof.Wxiw[1],
    proof.eval_a, proof.eval_b, proof.eval_c,
    proof.eval_s1, proof.eval_s2,
    proof.eval_zw,
  ].map(String);
}
```

### Step 2.6 — POST /elections/:addr/votes

```http
POST /elections/0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512/votes
Content-Type: application/json

{
  "raceId": 1,
  "pubSignals": [
    "55611993240970768952087494670654066999148413726872304615847127328622947368",
    "78340293847502938475029384750293847502938475029384750293847502938475029384",
    "42",
    "1",
    "1",
    "0"
  ],
  "proof": [
    "12345678901234567890123456789012345678901234567890123456789012345678",
    "98765432109876543210987654321098765432109876543210987654321098765432",
    ... (22 more values, 24 total)
  ]
}
```

**Field rules:**

| Field | Type | Notes |
|---|---|---|
| `raceId` | integer | Must match `pubSignals[4]` |
| `pubSignals` | array of 6 decimal strings | Canonical order above |
| `proof` | array of 24 decimal strings | Flattened PLONK proof |

**Response 202:**
```json
{
  "txHash": "0xd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
  "nullifier": "78340293847502938475029384750293847502938475029384750293847502938"
}
```

Save the `nullifier`. The voter uses it to check their vote receipt:

```http
GET /elections/:addr/votes/78340293847502938475029384750293847502938
```

---

## Field Reference

### Circuit private inputs

| Signal | Type | How to compute |
|---|---|---|
| `voter_id` | decimal string | CPF stripped of all formatting (`"123.456.789-01"` → `"12345678901"`) |
| `merkle_path[4]` | array of 4 decimal strings | `pathElements` from `GET /voters/:commitment` |
| `merkle_path_indices[4]` | array of 4 ints (0 or 1) | `pathIndices` from `GET /voters/:commitment` |

**`merkle_path_indices` semantics:**  
`0` = the voter's node is the **left** child at this level → sibling is on the right.  
`1` = the voter's node is the **right** child → sibling is on the left.

All four are `0` for voter at `leafIndex = 0` (always left-most).

For `leafIndex = 5` (binary `0101`):
```
level 0 bit = 1 → voter is right child
level 1 bit = 0 → voter is left child
level 2 bit = 1 → voter is right child
level 3 bit = 0 → voter is left child
pathIndices = [1, 0, 1, 0]
```

### Circuit public inputs (pubSignals)

| Index | Signal | Type | How to get |
|---|---|---|---|
| `[0]` | `merkle_root` | decimal string | `GET /voters/:commitment` → `.root`, or `GET /elections/:addr` → `.merkleRoot` |
| `[1]` | `nullifier_hash` | decimal string | `Poseidon(voter_id, election_id, race_id, pick_index)` — computed client-side |
| `[2]` | `candidate_id` | decimal string | Voter's choice: `"0"` = blank, `"999"` = null vote, `"42"` = candidate 42 |
| `[3]` | `election_id` | decimal string | `GET /elections/:addr` → `.electionId` (numeric ID stored in contract) |
| `[4]` | `race_id` | decimal string | `GET /elections/:addr/races` → `.raceId` of the race being voted in |
| `[5]` | `pick_index` | decimal string | `"0"` for single-pick races; `"0"` to `"maxPicks-1"` for multi-pick races |

### Proof array

The flat 24-element array maps to PLONK curve points in this order:

```
[0..1]   A  (G1 point)
[2..3]   B  (G1 point)
[4..5]   C  (G1 point)
[6..7]   Z  (G1 point)
[8..9]   T1 (G1 point)
[10..11] T2 (G1 point)
[12..13] T3 (G1 point)
[14..15] Wxi  (G1 point)
[16..17] Wxiw (G1 point)
[18]     eval_a
[19]     eval_b
[20]     eval_c
[21]     eval_s1
[22]     eval_s2
[23]     eval_zw
```

---

## Security Guarantees

| What is proven | How |
|---|---|
| The voter's CPF is in the authorized set | Circuit recomputes `Poseidon(voter_id)` and verifies the Merkle path against the on-chain root |
| The CPF was hashed correctly | The circuit performs the Poseidon hash internally — the commitment cannot be faked |
| The voter has not voted in this race before | The contract checks `nullifier_hash` has not been seen; the circuit constrains it to `Poseidon(voter_id, election_id, race_id, pick_index)` — an attacker cannot forge a different nullifier |
| The proof applies to this specific race | `race_id` and `pick_index` are **public** signals; a relayer cannot reuse the proof for a different race |
| `voter_id` is a valid CPF-sized number | Circuit enforces `voter_id < 2^40` (covers all 11-digit CPFs up to ~1.1 trillion) |

---

## Full Worked Example

Two voters, one race, one vote cast.

```js
const { buildPoseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");

async function fullExample() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const DEPTH = 4;
  const SIZE  = 16;

  // ── Phase 1: Admin registers voters ────────────────────────────────────────

  const voterIds = [12345678901n, 98765432100n]; // CPFs as BigInt

  // 1.1 Commitments
  const rawLeaves = new Array(SIZE).fill(F.zero);
  voterIds.forEach((id, i) => {
    rawLeaves[i] = poseidon([id]);
  });

  // 1.2 Build tree
  const levels = [rawLeaves];
  for (let d = 0; d < DEPTH; d++) {
    const prev = levels[d];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(poseidon([prev[i], prev[i+1]]));
    levels.push(next);
  }
  const root = F.toString(levels[DEPTH][0]);
  const commitments = voterIds.map((id) => F.toString(poseidon([id])));

  // 1.3 POST /elections/:addr/voters  (admin sends commitments + root)
  console.log("POST body:", { hashes: commitments, merkleRoot: root });

  // ── Phase 2: Voter 0 (CPF 12345678901) votes for candidate 42 in race 1 ───

  const voterIndex = 0;
  const voterId    = voterIds[voterIndex];   // 12345678901n
  const electionId = 1n;                     // from GET /elections/:addr
  const raceId     = 1n;
  const pickIndex  = 0n;
  const candidateId = 42n;

  // 2.1 Merkle proof
  const pathElements = [];
  const pathIndices  = [];
  let idx = voterIndex;
  for (let d = 0; d < DEPTH; d++) {
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(F.toString(levels[d][sib]));
    pathIndices.push(idx % 2);
    idx = Math.floor(idx / 2);
  }
  // pathElements = [commitment[1], H(zero,zero), H(...), H(...)]
  // pathIndices  = [0, 0, 0, 0]  (voter 0 is always left)

  // 2.2 Nullifier
  const nullifierHash = F.toString(poseidon([voterId, electionId, raceId, pickIndex]));

  // 2.3 Circuit input
  const circuitInput = {
    voter_id:            voterId.toString(),
    merkle_path:         pathElements,
    merkle_path_indices: pathIndices,
    merkle_root:         root,
    nullifier_hash:      nullifierHash,
    candidate_id:        candidateId.toString(),
    election_id:         electionId.toString(),
    race_id:             raceId.toString(),
    pick_index:          pickIndex.toString(),
  };

  // 2.4 Generate proof (~2s in browser)
  const { proof, publicSignals } = await snarkjs.plonk.fullProve(
    circuitInput,
    "/circuits/voter_proof.wasm",
    "/circuits/voter_proof.zkey",
  );

  // 2.5 Flatten
  const calldata = await snarkjs.plonk.exportSolidityCallData(proof, publicSignals);
  const [proofArray, pubSignalArray] = JSON.parse("[" + calldata + "]");

  // 2.6 POST /elections/:addr/votes
  const body = {
    raceId: Number(raceId),  // integer
    pubSignals: pubSignalArray,  // 6 decimal strings
    proof: proofArray,           // 24 decimal strings
  };
  console.log("POST body:", JSON.stringify(body, null, 2));
  // → response: { txHash: "0x...", nullifier: "..." }
}

fullExample().catch(console.error);
```

---

## Common Errors

| Error | Code | Cause | Fix |
|---|---|---|---|
| `pubSignals[3] election_id does not match` | `INVALID_ELECTION_ID` | `election_id` in circuit input doesn't match the contract | Fetch `electionId` from `GET /elections/:addr` and use it exactly |
| `pubSignals[4] race_id does not match raceId param` | `RACE_ID_MISMATCH` | `race_id` in `pubSignals` ≠ `raceId` in the POST body | Both must be the same value |
| `Nullifier already used` | `NULLIFIER_USED` | Voter already voted in this race | Expected behavior — one vote per (voter, race) |
| `Proof verification failed` (contract revert) | — | Wrong Merkle root, wrong path, mismatched `election_id`, or tree not zero-padded | Recompute all inputs using the zero-padded 16-leaf tree |
| `voter_id out of range` (circuit constraint fail) | — | CPF > 2^40 or non-numeric characters included | Strip all non-digits; CPF must be ≤ 11 digits |
| `included: false` from GET /voters | — | Voter's commitment not in the tree | Admin must register this voter via POST /voters before the election opens |
