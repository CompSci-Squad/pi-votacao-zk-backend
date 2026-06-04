"use strict";

import { ethers } from "ethers";
import { VOTING_CONTRACT_ABI } from "../lib/abis";
import { getProvider } from "./provider";

// ── ElectionState enum (mirrors Solidity) ─────────────────────────────────────
export enum ElectionState {
  PENDING = 0,
  OPEN = 1,
  FINISHED = 2,
}

export function stateLabel(s: number): string {
  return ElectionState[s] ?? "UNKNOWN";
}

// ── TypeScript mirrors of Solidity structs ────────────────────────────────────
export interface Candidate {
  id: bigint;
  name: string;
  party: string;
  number: bigint;
  voteCount: bigint;
}

export interface RaceSnapshot {
  raceId: bigint;
  name: string;
  candidates: Candidate[];
  blankVotes: bigint;
  nullVotes: bigint;
  totalVotes: bigint;
}

export interface EventState {
  address: string;
  electionName: string;
  electionDescription: string;
  admin: string;
  state: number;
  stateLabel: string;
  currentElectionId: bigint;
  voterMerkleRoot: bigint;
  racesCount: bigint;
  race0Name: string;
}

export interface RaceInfo {
  raceId: number;
  name: string;
  maxPicks: number;
  candidates: Candidate[];
}

export interface BoletimUrna {
  electionName: string;
  electionId: bigint;
  state: number;
  snapshots: RaceSnapshot[];
  voterCount: bigint;
  merkleRoot: bigint;
  grandTotalVotes: bigint;
  blockTimestamp: bigint;
  blockNumber: bigint;
}

// ── Contract factory helper ───────────────────────────────────────────────────

export function getVotingContract(addr: string): ethers.Contract {
  return new ethers.Contract(addr, VOTING_CONTRACT_ABI, getProvider());
}

// ── Read functions ────────────────────────────────────────────────────────────

/**
 * Fetch top-level event state (name, description, admin, state, merkle root, …).
 */
export async function readEventState(addr: string): Promise<EventState> {
  const c = getVotingContract(addr);
  const [
    electionName,
    electionDescription,
    admin,
    stateRaw,
    currentElectionId,
    voterMerkleRoot,
    racesCount,
    race0Name,
  ] = await Promise.all([
    c.electionName() as Promise<string>,
    c.electionDescription() as Promise<string>,
    c.admin() as Promise<string>,
    c.state() as Promise<bigint>,
    c.currentElectionId() as Promise<bigint>,
    c.voterMerkleRoot() as Promise<bigint>,
    c.racesCount() as Promise<bigint>,
    c.race0Name() as Promise<string>,
  ]);

  const stateNum = Number(stateRaw);
  // race 0 is invisible until named — don't count it in the visible total
  const visibleRacesCount = race0Name === "" ? racesCount - 1n : racesCount;
  return {
    address: addr,
    electionName,
    electionDescription,
    admin,
    state: stateNum,
    stateLabel: stateLabel(stateNum),
    currentElectionId,
    voterMerkleRoot,
    racesCount: visibleRacesCount,
    race0Name,
  };
}

/**
 * Fetch all races with their candidates and configuration.
 */
export async function readRaces(addr: string): Promise<RaceInfo[]> {
  const c = getVotingContract(addr);
  const total = Number(await c.racesCount());
  const races: RaceInfo[] = [];

  for (let raceId = 0; raceId < total; raceId++) {
    const [name, maxPicks, candidates] = await Promise.all([
      c.getRaceName(raceId) as Promise<string>,
      c.getRaceMaxPicks(raceId) as Promise<bigint>,
      c.getCandidatesByRace(raceId) as Promise<Candidate[]>,
    ]);
    // race 0 exists on every fresh contract but is not visible until named
    if (raceId === 0 && name === "") continue;
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
export async function readVoterCommitments(
  addr: string,
): Promise<{ commitment: bigint; leafIndex: number }[]> {
  const c = getVotingContract(addr);
  const filter = c.filters.VoterEnrolled();
  const logs = await c.queryFilter(filter, 0, "latest");

  const out: { commitment: bigint; leafIndex: number }[] = [];
  for (const log of logs) {
    const parsed = log as ethers.EventLog;
    out.push({
      commitment: parsed.args.commitment as bigint,
      leafIndex: Number(parsed.args.leafIndex),
    });
  }
  // Sort by leafIndex ascending
  out.sort((a, b) => a.leafIndex - b.leafIndex);
  return out;
}

/**
 * Return all VoteCast events for an event (for the RDV audit document).
 */
export interface VoteCastLog {
  nullifier: bigint;
  raceId: bigint;
  candidateId: bigint;
  pickIndex: number;
  txHash: string;
  blockNumber: number;
}

export async function readVoteCastLogs(addr: string): Promise<VoteCastLog[]> {
  const c = getVotingContract(addr);
  const filter = c.filters.VoteCast();
  const logs = await c.queryFilter(filter, 0, "latest");

  return logs.map((log) => {
    const parsed = log as ethers.EventLog;
    return {
      nullifier: parsed.args.nullifier as bigint,
      raceId: parsed.args.raceId as bigint,
      candidateId: parsed.args.candidateId as bigint,
      pickIndex: Number(parsed.args.pickIndex),
      txHash: parsed.transactionHash,
      blockNumber: parsed.blockNumber,
    };
  });
}

/** Check whether a nullifier has been spent for a given race. */
export async function isNullifierUsed(
  addr: string,
  raceId: bigint,
  nullifier: bigint,
): Promise<boolean> {
  const c = getVotingContract(addr);
  return c.isNullifierUsed(raceId, nullifier) as Promise<boolean>;
}

/** Fetch the multi-race Boletim de Urna. Available in any state. */
export async function readBoletimUrna(addr: string): Promise<BoletimUrna> {
  const c = getVotingContract(addr);
  const raw = await c.getBoletimUrna();
  return {
    electionName: raw.electionName as string,
    electionId: raw.electionId as bigint,
    state: Number(raw.state),
    snapshots: (raw.snapshots as RaceSnapshot[]).map((s) => ({
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
    voterCount: raw.voterCount as bigint,
    merkleRoot: raw.merkleRoot as bigint,
    grandTotalVotes: raw.grandTotalVotes as bigint,
    blockTimestamp: raw.blockTimestamp as bigint,
    blockNumber: raw.blockNumber as bigint,
  };
}
