"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOTING_CONTRACT_ABI = exports.VOTING_FACTORY_ABI = void 0;
/**
 * Human-readable ABI fragments for VotingFactory and VotingContract.
 *
 * These are inlined so the backend has no build-time dependency on the
 * pi-votacao-zk-blockchain Foundry out/ directory. If the contract ABI
 * changes, update both here AND in the contract source — they must stay
 * in sync.
 *
 * Public-signal boundary (non-negotiable, matches .github/copilot-instructions §2.1):
 *   pubSignals[0] = merkle_root
 *   pubSignals[1] = nullifier_hash   Poseidon(voter_id, election_id, race_id, pick_index)
 *   pubSignals[2] = candidate_id     0=blank, 999=null, 1..N=candidate
 *   pubSignals[3] = election_id
 *   pubSignals[4] = race_id
 *   pubSignals[5] = pick_index
 *
 * castVote ABI: castVote(uint256 raceId, uint256[6] pubSignals, uint256[24] proof)
 */
// ── Candidate tuple (used by multiple functions) ─────────────────────────────
const CANDIDATE_TUPLE = "tuple(uint256 id, string name, string party, uint256 number, uint256 voteCount)";
// ── RaceSnapshot tuple ────────────────────────────────────────────────────────
const RACE_SNAPSHOT_TUPLE = `tuple(uint256 raceId, string name, ${CANDIDATE_TUPLE}[] candidates, uint256 blankVotes, uint256 nullVotes, uint256 totalVotes)`;
// ── VotingFactory ─────────────────────────────────────────────────────────────
exports.VOTING_FACTORY_ABI = [
    "function eventCount() view returns (uint256)",
    "function events(uint256 index) view returns (address)",
    "function verifier() view returns (address)",
    "function auditor() view returns (address)",
    "function createEvent(string name, string description) returns (address)",
    "function auditAnchor(uint256 epoch, bytes32 root)",
    "function setAuditor(address newAuditor)",
    "event EventCreated(uint256 indexed eventId, address indexed admin, address eventAddress, string name)",
    "event AuditAnchor(uint256 indexed epoch, bytes32 root)",
    "event AuditorTransferred(address indexed previousAuditor, address indexed newAuditor)",
];
// ── VotingContract ────────────────────────────────────────────────────────────
exports.VOTING_CONTRACT_ABI = [
    // ── State variables (public getters) ─────────────────────────────────────
    "function electionName() view returns (string)",
    "function electionDescription() view returns (string)",
    "function state() view returns (uint8)",
    "function currentElectionId() view returns (uint256)",
    "function voterMerkleRoot() view returns (uint256)",
    "function admin() view returns (address)",
    "function extraRacesCount() view returns (uint256)",
    "function race0Name() view returns (string)",
    "function race0MaxPicks() view returns (uint8)",
    "function blankVotes() view returns (uint256)",
    "function nullVotes() view returns (uint256)",
    "function totalVotes() view returns (uint256)",
    // ── Race helpers ──────────────────────────────────────────────────────────
    "function racesCount() view returns (uint256)",
    "function getRaceName(uint256 raceId) view returns (string)",
    "function getRaceMaxPicks(uint256 raceId) view returns (uint8)",
    // ── Candidate helpers ─────────────────────────────────────────────────────
    `function getCandidates() view returns (${CANDIDATE_TUPLE}[])`,
    `function getCandidatesByRace(uint256 raceId) view returns (${CANDIDATE_TUPLE}[])`,
    "function getCandidateCount() view returns (uint256)",
    // ── Voter helpers ─────────────────────────────────────────────────────────
    "function getVoterHashes() view returns (uint256[])",
    // ── Nullifier check ───────────────────────────────────────────────────────
    "function isNullifierUsed(uint256 raceId, uint256 nullifier) view returns (bool)",
    "function nullifiers(uint256 raceId, uint256 nullifier) view returns (bool)",
    // ── Results ───────────────────────────────────────────────────────────────
    `function getResults() view returns (${CANDIDATE_TUPLE}[] candidates, uint256 blankVotes, uint256 nullVotes, uint256 totalVotes)`,
    `function getRaceResults(uint256 raceId) view returns (${CANDIDATE_TUPLE}[] candidates, uint256 blankVotes, uint256 nullVotes, uint256 totalVotes)`,
    // ── Audit views ───────────────────────────────────────────────────────────
    `function getZeresima() view returns (string electionName, ${CANDIDATE_TUPLE}[] candidates, uint256 voterCount, bool allZero, uint256 blockTimestamp, uint256 blockNumber)`,
    `function getZeresimaMultiRace() view returns (string electionName, uint256 electionId, ${RACE_SNAPSHOT_TUPLE}[] snapshots, uint256 voterCount, uint256 merkleRoot, bool allZero, uint256 blockTimestamp, uint256 blockNumber)`,
    `function getBoletimUrna() view returns (string electionName, uint256 electionId, uint8 state, ${RACE_SNAPSHOT_TUPLE}[] snapshots, uint256 voterCount, uint256 merkleRoot, uint256 grandTotalVotes, uint256 blockTimestamp, uint256 blockNumber)`,
    // ── Voting ────────────────────────────────────────────────────────────────
    "function castVote(uint256 raceId, uint256[6] pubSignals, uint256[24] proof)",
    // ── Admin (read-only helpers exposed via backend) ─────────────────────────
    "function openElection()",
    "function closeElection()",
    // ── Events ────────────────────────────────────────────────────────────────
    "event ElectionCreated(string name, uint256 electionId)",
    "event CandidateAdded(uint256 indexed id, string name, uint256 number)",
    "event RaceAdded(uint256 indexed raceId, string name)",
    "event VoterHashesRegistered(uint256[] hashes)",
    "event VoterEnrolled(uint256 indexed commitment, uint256 indexed leafIndex)",
    "event MerkleRootSet(uint256 root)",
    "event ElectionOpened(uint256 timestamp, uint256 electionId)",
    "event ElectionClosed(uint256 timestamp, uint256 totalVotes)",
    "event VoteCast(uint256 indexed nullifier, uint256 indexed raceId, uint256 indexed candidateId, uint8 pickIndex)",
    // ── Custom errors ─────────────────────────────────────────────────────────
    "error NotAdmin()",
    "error ElectionNotOpen()",
    "error ElectionNotPending()",
    "error ElectionNotFinished()",
    "error InvalidMerkleRoot(uint256 provided, uint256 expected)",
    "error InvalidElectionId(uint256 provided, uint256 expected)",
    "error InvalidRaceId(uint256 provided)",
    "error RaceIdMismatch(uint256 paramRaceId, uint256 signalRaceId)",
    "error NullifierAlreadyUsed(uint256 nullifier)",
    "error InvalidProof()",
    "error CandidateNotFound(uint256 candidateId)",
    "error PickIndexOutOfRange(uint256 raceId, uint256 pickIndex, uint8 maxPicks)",
];
//# sourceMappingURL=abis.js.map