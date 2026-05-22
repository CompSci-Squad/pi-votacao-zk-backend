# Voting Backend API

Base URL: `http://localhost:3000`  
All request/response bodies are JSON.  All on-chain numeric values (bigints) are serialised as **decimal strings**.

---

## Authentication

Write operations (POST, PATCH) are executed on-chain by the backend using the key configured in `ADMIN_PRIVATE_KEY` (or `RELAYER_PRIVATE_KEY` as fallback).  In local dev both keys are the same anvil account 0.  **No token is required from the caller for admin operations.**

Vote relay (`POST /elections/:addr/votes`) uses `RELAYER_PRIVATE_KEY`.  An optional `x-voter-token` header is accepted for per-voter rate limiting.

---

## Resource Model

```
VotingFactory  ─────────────────────────────── /elections
  └── VotingContract (election)  ─────────────── /elections/:addr
        ├── races                ─────────────── /elections/:addr/races
        │     └── candidates     ─────────────── /elections/:addr/races/:raceId/candidates
        ├── voters               ─────────────── /elections/:addr/voters
        ├── votes (relay)        ─────────────── /elections/:addr/votes
        └── audit                ─────────────── /elections/:addr/results
                                                 /elections/:addr/audit/*
```

### Election lifecycle (state machine)

```
PENDING  ──[PATCH state=OPEN]──►  OPEN  ──[PATCH state=FINISHED]──►  FINISHED
   │                                │
   │ addCandidate, addRace,         │ castVote (via /votes)
   │ registerVoters, setMerkleRoot  │
```

---

## Endpoints

### Health

#### `GET /health`

Returns server liveness.

```bash
curl http://localhost:3000/health
```

```json
{ "ok": true, "ts": 1747872000000 }
```

---

### Elections

#### `GET /elections`

List all elections deployed by the factory.

```bash
curl http://localhost:3000/elections
```

```json
[
  {
    "eventId": "1",
    "address": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "name": "Eleição de Teste",
    "admin": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "createdAtBlock": 3
  }
]
```

---

#### `POST /elections`

Create a new election via `VotingFactory.createEvent()`.  The backend signs with `ADMIN_PRIVATE_KEY`.  Returns the address of the deployed `VotingContract`.

```bash
curl -X POST http://localhost:3000/elections \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Eleição Municipal 2026", "description": "Prefeitura e Câmara" }'
```

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✓ | Election display name |
| `description` | string | ✓ | Short description |

**Response 201**

```json
{
  "txHash": "0xabc...",
  "blockNumber": 4,
  "address": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
}
```

---

#### `GET /elections/:addr`

Full election state: metadata, state machine, races, and candidate counts.

```bash
curl http://localhost:3000/elections/0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

**Response 200**

```json
{
  "eventId": "1",
  "address": "0x9fE46736...",
  "name": "Eleição Municipal 2026",
  "electionName": "Eleição Municipal 2026",
  "electionDescription": "Prefeitura e Câmara",
  "admin": "0xf39Fd6...",
  "state": 0,
  "stateLabel": "PENDING",
  "currentElectionId": "1",
  "voterMerkleRoot": "0",
  "racesCount": "1",
  "races": [
    { "raceId": 0, "name": "", "maxPicks": 1, "candidates": [] }
  ]
}
```

---

#### `PATCH /elections/:addr`

Transition the election state.

```bash
# Open voting
curl -X PATCH http://localhost:3000/elections/0x9fE4... \
  -H 'Content-Type: application/json' \
  -d '{ "state": "OPEN" }'

# Close voting (lock results)
curl -X PATCH http://localhost:3000/elections/0x9fE4... \
  -H 'Content-Type: application/json' \
  -d '{ "state": "FINISHED" }'
```

**Body**

| Field | Type | Allowed values | Description |
|---|---|---|---|
| `state` | string | `"OPEN"` \| `"FINISHED"` | Target state |

**Response 200**

```json
{ "txHash": "0xdef...", "blockNumber": 10 }
```

---

### Races

#### `GET /elections/:addr/races`

List all races in an election.

```bash
curl http://localhost:3000/elections/0x9fE4.../races
```

```json
[
  { "raceId": 0, "name": "Prefeito", "maxPicks": 1, "candidates": [] },
  { "raceId": 1, "name": "Vereador", "maxPicks": 3, "candidates": [] }
]
```

---

#### `POST /elections/:addr/races`

Add a new race (raceId ≥ 1).  Race 0 always exists; use `PATCH /races/0` to set its name.

```bash
curl -X POST http://localhost:3000/elections/0x9fE4.../races \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Vereador" }'
```

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✓ | Race display name |

**Response 201**

```json
{ "txHash": "0x...", "blockNumber": 5, "raceId": 1 }
```

---

#### `GET /elections/:addr/races/:raceId`

Single race with candidates.

```bash
curl http://localhost:3000/elections/0x9fE4.../races/0
```

```json
{
  "raceId": 0,
  "name": "Prefeito",
  "maxPicks": 1,
  "candidates": [
    { "id": "1", "name": "Alice Oliveira", "party": "PT",  "number": "13", "voteCount": "0" },
    { "id": "2", "name": "Bruno Silva",    "party": "PSD", "number": "45", "voteCount": "0" }
  ]
}
```

---

#### `PATCH /elections/:addr/races/:raceId`

Update race 0 name or any race's `maxPicks`.

```bash
# Set race 0 name
curl -X PATCH http://localhost:3000/elections/0x9fE4.../races/0 \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Prefeito" }'

# Set maxPicks for race 1 (multi-choice)
curl -X PATCH http://localhost:3000/elections/0x9fE4.../races/1 \
  -H 'Content-Type: application/json' \
  -d '{ "maxPicks": 3 }'
```

**Body** (at least one field required)

| Field | Type | Description |
|---|---|---|
| `name` | string | New display name — race 0 only |
| `maxPicks` | integer ≥ 1 | Max picks per voter in this race |

**Response 200** — array of tx receipts for each applied change

```json
[{ "txHash": "0x...", "blockNumber": 6 }]
```

---

### Candidates

#### `GET /elections/:addr/races/:raceId/candidates`

List all candidates in a race.

```bash
curl http://localhost:3000/elections/0x9fE4.../races/0/candidates
```

```json
[
  { "id": "1", "name": "Alice Oliveira", "party": "PT",  "number": "13", "voteCount": "0" },
  { "id": "2", "name": "Bruno Silva",    "party": "PSD", "number": "45", "voteCount": "0" }
]
```

---

#### `POST /elections/:addr/races/:raceId/candidates`

Add a candidate to a race.  Election must be PENDING.

```bash
curl -X POST http://localhost:3000/elections/0x9fE4.../races/0/candidates \
  -H 'Content-Type: application/json' \
  -d '{ "name": "Alice Oliveira", "party": "PT", "number": 13 }'
```

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✓ | Candidate full name |
| `party` | string | ✓ | Party name or abbreviation |
| `number` | integer 1–998 | ✓ | Ballot number (unique in race; 0 = blank, 999 = null/spoiled) |

**Response 201**

```json
{ "txHash": "0x...", "blockNumber": 7 }
```

---

#### `GET /elections/:addr/races/:raceId/candidates/:candidateId`

Single candidate.

```bash
curl http://localhost:3000/elections/0x9fE4.../races/0/candidates/1
```

```json
{ "id": "1", "name": "Alice Oliveira", "party": "PT", "number": "13", "voteCount": "0" }
```

---

### Voters

#### `GET /elections/:addr/voters`

List enrolled voter commitments (Poseidon(voter_id)) in leaf-index order.

```bash
curl http://localhost:3000/elections/0x9fE4.../voters
```

```json
[
  { "commitment": "1", "leafIndex": 0 },
  { "commitment": "2", "leafIndex": 1 }
]
```

---

#### `POST /elections/:addr/voters`

Register voter identity hashes and set the Merkle root in a single step.  
Election must be PENDING and hashes must not have been registered yet.

```bash
curl -X POST http://localhost:3000/elections/0x9fE4.../voters \
  -H 'Content-Type: application/json' \
  -d '{
    "hashes": ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15"],
    "merkleRoot": "12345678901234567890"
  }'
```

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `hashes` | string\[] (1–16) | ✓ | Poseidon(voter\_id) for each voter, as decimal strings |
| `merkleRoot` | string | ✓ | Poseidon Merkle root of the voter set, as decimal string |

> **Note:** `merkleRoot` must be computed off-chain from the same `hashes` array using the same depth-4 Poseidon Merkle tree as the ZK circuit.  Use `pi-votacao-zk-circuits` scripts to compute it.

**Response 201**

```json
{
  "hashes":     { "txHash": "0x...", "blockNumber": 8 },
  "merkleRoot": { "txHash": "0x...", "blockNumber": 9 }
}
```

---

#### `GET /elections/:addr/voters/:commitment`

Merkle inclusion proof for a voter commitment.  The voter's browser uses this to build ZK circuit inputs.

```bash
# commitment = Poseidon(voter_id) as decimal string
curl http://localhost:3000/elections/0x9fE4.../voters/1
```

**Response 200 — voter found**

```json
{
  "included":     true,
  "leafIndex":    0,
  "pathElements": ["2", "11072544958804305", "123456789", "987654321"],
  "pathIndices":  [0, 1, 0, 0],
  "root":         "12345678901234567890"
}
```

**Response 200 — voter not found**

```json
{ "included": false, "leafIndex": -1, "pathElements": [], "pathIndices": [], "root": "12345678..." }
```

---

### Votes (ZK proof relay)

#### `POST /elections/:addr/votes`

Submit a PLONK proof on behalf of a voter.  Election must be OPEN.  The backend submits `castVote` on-chain using `RELAYER_PRIVATE_KEY`.

```bash
curl -X POST http://localhost:3000/elections/0x9fE4.../votes \
  -H 'Content-Type: application/json' \
  -d '{
    "raceId": 0,
    "pubSignals": ["1", "9876543210", "1", "1", "0", "0"],
    "proof": [
      "0","0","0","0","0","0","0","0","0","0","0","0",
      "0","0","0","0","0","0","0","0","0","0","0","0"
    ]
  }'
```

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `raceId` | integer ≥ 0 | ✓ | Race to vote in |
| `pubSignals` | string\[6] | ✓ | Public signals in canonical order (see below) |
| `proof` | string\[24] | ✓ | PLONK proof field elements from SnarkJS |

**`pubSignals` canonical order:**

| Index | Signal | Value |
|---|---|---|
| `[0]` | `merkle_root` | Must equal `voterMerkleRoot` on-chain |
| `[1]` | `nullifier_hash` | `Poseidon(voter_id, election_id, race_id, pick_index)` |
| `[2]` | `candidate_id` | `0` = blank, `999` = null/spoiled, `1..N` = candidate id |
| `[3]` | `election_id` | Must equal `currentElectionId` on-chain |
| `[4]` | `race_id` | Must equal `raceId` param |
| `[5]` | `pick_index` | `0..maxPicks-1` |

> **Note:** With `MockVerifier` (deployed by `setup_dev.js`), any 24-element proof passes.  With the real `PlonkVerifier`, use `pi-votacao-zk-circuits` to generate a valid proof.

**Optional headers**

| Header | Description |
|---|---|
| `x-voter-token` | Opaque voter token used for per-voter rate limiting |

**Response 202**

```json
{ "txHash": "0xabc...", "nullifier": "9876543210" }
```

**Error codes**

| Code | HTTP | Meaning |
|---|---|---|
| `ELECTION_NOT_OPEN` | 400 | Election is not in OPEN state |
| `NULLIFIER_USED` | 409 | This voter already voted in this race |
| `NULLIFIER_PENDING` | 400 | Proof is already in-flight |
| `INVALID_ELECTION_ID` | 400 | pubSignals\[3] doesn't match on-chain |
| `RACE_ID_MISMATCH` | 400 | pubSignals\[4] doesn't match raceId param |
| `PROOF_REJECTED` | 400 | On-chain verifier rejected the proof |
| `RATE_LIMITED` | 429 | Too many requests |

---

### Results & Audit

#### `GET /elections/:addr/results`

Boletim de Urna — final vote counts per candidate, per race.

```bash
curl http://localhost:3000/elections/0x9fE4.../results
```

```json
{
  "electionName": "Eleição Municipal 2026",
  "electionId": "1",
  "state": 2,
  "snapshots": [
    {
      "raceId": "0",
      "name": "Prefeito",
      "candidates": [
        { "id": "1", "name": "Alice Oliveira", "party": "PT", "number": "13", "voteCount": "7" },
        { "id": "2", "name": "Bruno Silva",    "party": "PSD","number": "45", "voteCount": "5" }
      ],
      "blankVotes": "1",
      "nullVotes":  "2",
      "totalVotes": "15"
    }
  ],
  "voterCount": "15",
  "merkleRoot": "12345678901234567890",
  "grandTotalVotes": "15",
  "blockTimestamp": "1747872000",
  "blockNumber": "42"
}
```

---

#### `GET /elections/:addr/audit/zeresima`

Zero-vote certificate — proves all counts are zero before voting opens.  
Election must be PENDING.

```bash
curl http://localhost:3000/elections/0x9fE4.../audit/zeresima
```

---

#### `GET /elections/:addr/audit/bu`

Alias for `/results`.

---

#### `GET /elections/:addr/audit/rdv`

Registro Digital de Voto — reconstructed from on-chain `VoteCast` events.

```bash
curl http://localhost:3000/elections/0x9fE4.../audit/rdv
```

---

#### `GET /elections/:addr/audit/pending`

In-flight proof accountability log (current epoch + ring-buffer history).

```bash
curl http://localhost:3000/elections/0x9fE4.../audit/pending
```

```json
{
  "currentEpoch": [
    {
      "ts": 1747872000000,
      "eventAddr": "0x9fe4...",
      "proofHash": "abcdef...",
      "nullifier": "9876543210",
      "raceId": "0",
      "pickIndex": "0",
      "submitted": true,
      "txHash": "0xabc..."
    }
  ],
  "history": []
}
```

---

## Setup Workflow (full example)

```bash
export BASE=http://localhost:3000

# 1. Create election
ADDR=$(curl -sX POST $BASE/elections \
  -H 'Content-Type: application/json' \
  -d '{"name":"Eleição 2026","description":"Prefeitura"}' \
  | jq -r .address)

# 2. Name race 0
curl -sX PATCH $BASE/elections/$ADDR/races/0 \
  -H 'Content-Type: application/json' \
  -d '{"name":"Prefeito"}'

# 3. Add candidates
curl -sX POST $BASE/elections/$ADDR/races/0/candidates \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice Oliveira","party":"PT","number":13}'

curl -sX POST $BASE/elections/$ADDR/races/0/candidates \
  -H 'Content-Type: application/json' \
  -d '{"name":"Bruno Silva","party":"PSD","number":45}'

# 4. Register voters + merkle root
curl -sX POST $BASE/elections/$ADDR/voters \
  -H 'Content-Type: application/json' \
  -d '{"hashes":["1","2","3"],"merkleRoot":"<poseidon_root>"}'

# 5. Open election
curl -sX PATCH $BASE/elections/$ADDR \
  -H 'Content-Type: application/json' \
  -d '{"state":"OPEN"}'

# 6. Cast a vote (with MockVerifier — any proof passes)
curl -sX POST $BASE/elections/$ADDR/votes \
  -H 'Content-Type: application/json' \
  -d '{
    "raceId":0,
    "pubSignals":["<merkle_root>","<nullifier>","1","1","0","0"],
    "proof":["0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0"]
  }'

# 7. Close and view results
curl -sX PATCH $BASE/elections/$ADDR \
  -H 'Content-Type: application/json' \
  -d '{"state":"FINISHED"}'

curl -s $BASE/elections/$ADDR/results | jq
```

---

## Legacy Endpoints (backwards compatible)

The old `/events` prefix is kept and mirrors every route above:

| Old path | New path |
|---|---|
| `GET /events` | `GET /elections` |
| `GET /events/:addr` | `GET /elections/:addr` |
| `GET /events/:addr/results` | `GET /elections/:addr/results` |
| `GET /events/:addr/audit/*` | `GET /elections/:addr/audit/*` |
| `GET /events/:addr/voters/:commitment` | `GET /elections/:addr/voters/:commitment` |
| `POST /events/:addr/relay` | `POST /elections/:addr/votes` |
| `GET /events/:addr/admin/state` | — (use `GET /elections/:addr`) |
| `GET /events/:addr/admin/voters` | — (use `GET /elections/:addr/voters`) |

---

## Error Response Shape

```json
{ "error": "Human-readable message", "code": "MACHINE_READABLE_CODE" }
```

| HTTP | Meaning |
|---|---|
| 400 | Bad request — validation or contract pre-check failed |
| 404 | Resource not found |
| 409 | Conflict — nullifier already used |
| 429 | Rate limited |
| 501 | Feature not configured (e.g. FACTORY_ADDRESS not set) |
| 500 | Internal server error |
