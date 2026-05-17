"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectionState = void 0;
exports.stateLabel = stateLabel;
exports.getVotingContract = getVotingContract;
exports.readEventState = readEventState;
exports.readRaces = readRaces;
exports.readVoterCommitments = readVoterCommitments;
exports.readVoteCastLogs = readVoteCastLogs;
exports.isNullifierUsed = isNullifierUsed;
exports.readBoletimUrna = readBoletimUrna;
const ethers_1 = require("ethers");
const abis_1 = require("../lib/abis");
const provider_1 = require("./provider");
// ── ElectionState enum (mirrors Solidity) ─────────────────────────────────────
var ElectionState;
(function (ElectionState) {
    ElectionState[ElectionState["PENDING"] = 0] = "PENDING";
    ElectionState[ElectionState["OPEN"] = 1] = "OPEN";
    ElectionState[ElectionState["FINISHED"] = 2] = "FINISHED";
})(ElectionState || (exports.ElectionState = ElectionState = {}));
function stateLabel(s) {
    return ElectionState[s] ?? "UNKNOWN";
}
// ── Contract factory helper ───────────────────────────────────────────────────
function getVotingContract(addr) {
    return new ethers_1.ethers.Contract(addr, abis_1.VOTING_CONTRACT_ABI, (0, provider_1.getProvider)());
}
// ── Read functions ────────────────────────────────────────────────────────────
/**
 * Fetch top-level event state (name, description, admin, state, merkle root, …).
 */
async function readEventState(addr) {
    const c = getVotingContract(addr);
    const [electionName, electionDescription, admin, stateRaw, currentElectionId, voterMerkleRoot, racesCount, race0Name,] = await Promise.all([
        c.electionName(),
        c.electionDescription(),
        c.admin(),
        c.state(),
        c.currentElectionId(),
        c.voterMerkleRoot(),
        c.racesCount(),
        c.race0Name(),
    ]);
    const stateNum = Number(stateRaw);
    return {
        address: addr,
        electionName,
        electionDescription,
        admin,
        state: stateNum,
        stateLabel: stateLabel(stateNum),
        currentElectionId,
        voterMerkleRoot,
        racesCount,
        race0Name,
    };
}
/**
 * Fetch all races with their candidates and configuration.
 */
async function readRaces(addr) {
    const c = getVotingContract(addr);
    const total = Number(await c.racesCount());
    const races = [];
    for (let raceId = 0; raceId < total; raceId++) {
        const [name, maxPicks, candidates] = await Promise.all([
            c.getRaceName(raceId),
            c.getRaceMaxPicks(raceId),
            c.getCandidatesByRace(raceId),
        ]);
        races.push({
            raceId,
            name,
            maxPicks: Number(maxPicks),
            candidates: candidates.map((cand) => ({
                id: cand.id,
                name: cand.name,
                party: cand.party,
                number: cand.number,
                voteCount: cand.voteCount,
            })),
        });
    }
    return races;
}
/**
 * Return all voter commitments (Poseidon(voter_id) values) in leaf-index order,
 * sourced from on-chain VoterEnrolled events.
 *
 * Indexed event: VoterEnrolled(uint256 indexed commitment, uint256 indexed leafIndex)
 */
async function readVoterCommitments(addr) {
    const c = getVotingContract(addr);
    const filter = c.filters.VoterEnrolled();
    const logs = await c.queryFilter(filter, 0, "latest");
    const out = [];
    for (const log of logs) {
        const parsed = log;
        out.push({
            commitment: parsed.args.commitment,
            leafIndex: Number(parsed.args.leafIndex),
        });
    }
    // Sort by leafIndex ascending
    out.sort((a, b) => a.leafIndex - b.leafIndex);
    return out;
}
async function readVoteCastLogs(addr) {
    const c = getVotingContract(addr);
    const filter = c.filters.VoteCast();
    const logs = await c.queryFilter(filter, 0, "latest");
    return logs.map((log) => {
        const parsed = log;
        return {
            nullifier: parsed.args.nullifier,
            raceId: parsed.args.raceId,
            candidateId: parsed.args.candidateId,
            pickIndex: Number(parsed.args.pickIndex),
            txHash: parsed.transactionHash,
            blockNumber: parsed.blockNumber,
        };
    });
}
/** Check whether a nullifier has been spent for a given race. */
async function isNullifierUsed(addr, raceId, nullifier) {
    const c = getVotingContract(addr);
    return c.isNullifierUsed(raceId, nullifier);
}
/** Fetch the multi-race Boletim de Urna. Available in any state. */
async function readBoletimUrna(addr) {
    const c = getVotingContract(addr);
    const raw = await c.getBoletimUrna();
    return {
        electionName: raw.electionName,
        electionId: raw.electionId,
        state: Number(raw.state),
        snapshots: raw.snapshots.map((s) => ({
            raceId: s.raceId,
            name: s.name,
            candidates: s.candidates.map((cand) => ({
                id: cand.id,
                name: cand.name,
                party: cand.party,
                number: cand.number,
                voteCount: cand.voteCount,
            })),
            blankVotes: s.blankVotes,
            nullVotes: s.nullVotes,
            totalVotes: s.totalVotes,
        })),
        voterCount: raw.voterCount,
        merkleRoot: raw.merkleRoot,
        grandTotalVotes: raw.grandTotalVotes,
        blockTimestamp: raw.blockTimestamp,
        blockNumber: raw.blockNumber,
    };
}
//# sourceMappingURL=event.js.map