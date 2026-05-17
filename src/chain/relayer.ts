"use strict";

import { ethers } from "ethers";
import { VOTING_CONTRACT_ABI } from "../lib/abis";
import { getProvider } from "./provider";
import { config } from "../config";
import { badRequest, conflict, internal } from "../lib/errors";
import { knownEventAddresses } from "./factory";
import { readEventState, isNullifierUsed, ElectionState } from "./event";

// ── Relayer wallet singleton ──────────────────────────────────────────────────

let _wallet: ethers.Wallet | null = null;

export function getRelayerWallet(): ethers.Wallet {
  if (!_wallet) {
    _wallet = new ethers.Wallet(config.relayerPrivateKey, getProvider());
  }
  return _wallet;
}

/** Test helper — inject a pre-funded wallet without touching process.env. */
export function setRelayerWallet(w: ethers.Wallet): void {
  _wallet = w;
}

export function _resetRelayerForTests(): void {
  _wallet = null;
}

// ── Rate limiter (in-memory token bucket) ─────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const _rateBuckets = new Map<string, RateBucket>();

/**
 * Check and consume one token from the rate bucket for key.
 * Returns false if the rate limit has been exceeded.
 */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = _rateBuckets.get(key);

  if (!bucket || now - bucket.windowStart > config.rateWindowMs) {
    _rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= config.rateLimitCount) return false;
  bucket.count++;
  return true;
}

/** Flush all buckets (test helper). */
export function _flushRateBuckets(): void {
  _rateBuckets.clear();
}

// ── Relay guards ──────────────────────────────────────────────────────────────

export interface RelayGuardsDeps {
  isKnownEvent(addr: string): Promise<boolean>;
  getElectionId(addr: string): Promise<bigint>;
  getElectionState(addr: string): Promise<number>;
  getRacesCount(addr: string): Promise<bigint>;
  checkNullifierUsed(
    addr: string,
    raceId: bigint,
    nullifier: bigint,
  ): Promise<boolean>;
}

/** Default production deps — talk to the real chain. */
export const defaultRelayGuardsDeps: RelayGuardsDeps = {
  async isKnownEvent(addr) {
    const known = await knownEventAddresses();
    return known.has(addr.toLowerCase());
  },
  async getElectionId(addr) {
    const s = await readEventState(addr);
    return s.currentElectionId;
  },
  async getElectionState(addr) {
    const s = await readEventState(addr);
    return s.state;
  },
  async getRacesCount(addr) {
    const s = await readEventState(addr);
    return s.racesCount;
  },
  async checkNullifierUsed(addr, raceId, nullifier) {
    return isNullifierUsed(addr, raceId, nullifier);
  },
};

export interface RelayParams {
  eventAddr: string;
  raceId: bigint;
  pubSignals: bigint[]; // 6 elements
  proof: bigint[]; // 24 elements
  voterToken?: string; // x-voter-token header (optional rate-limit key)
  clientIp?: string;
}

/**
 * Run all off-chain relay guards.  Throws AppError on any violation.
 *
 * Order mirrors the contract's own check order so we fail fast with a
 * human-readable message before spending gas:
 *   1. Event registered in factory
 *   2. Election is OPEN
 *   3. pubSignals[3] election_id matches chain
 *   4. pubSignals[4] race_id matches raceId param
 *   5. raceId < racesCount
 *   6. Nullifier not already used (cheap pre-check, saves gas)
 *   7. Rate limit
 */
export async function validateRelayRequest(
  params: RelayParams,
  deps: RelayGuardsDeps = defaultRelayGuardsDeps,
): Promise<void> {
  const { eventAddr, raceId, pubSignals } = params;

  // 1. Event registered
  if (!(await deps.isKnownEvent(eventAddr))) {
    throw badRequest(
      `${eventAddr} is not a VotingEvent deployed by the factory`,
      "UNKNOWN_EVENT",
    );
  }

  // 2. Election is OPEN
  const stateNum = await deps.getElectionState(eventAddr);
  if (stateNum !== ElectionState.OPEN) {
    throw badRequest(
      `Election is not OPEN (current state: ${ElectionState[stateNum] ?? stateNum})`,
      "ELECTION_NOT_OPEN",
    );
  }

  // 3. election_id matches pubSignals[3]
  const onChainElectionId = await deps.getElectionId(eventAddr);
  const signalElectionId = pubSignals[3];
  if (signalElectionId !== onChainElectionId) {
    throw badRequest(
      `pubSignals[3] election_id (${signalElectionId}) does not match on-chain electionId (${onChainElectionId})`,
      "INVALID_ELECTION_ID",
    );
  }

  // 4. race_id matches raceId param
  const signalRaceId = pubSignals[4];
  if (signalRaceId !== raceId) {
    throw badRequest(
      `pubSignals[4] race_id (${signalRaceId}) does not match raceId param (${raceId})`,
      "RACE_ID_MISMATCH",
    );
  }

  // 5. raceId < racesCount
  const racesCount = await deps.getRacesCount(eventAddr);
  if (raceId >= racesCount) {
    throw badRequest(`raceId ${raceId} is out of range (racesCount=${racesCount})`, "INVALID_RACE_ID");
  }

  // 6. Nullifier not already used (pre-check)
  const nullifier = pubSignals[1];
  if (await deps.checkNullifierUsed(eventAddr, raceId, nullifier)) {
    throw conflict("Nullifier already used", "NULLIFIER_USED");
  }

  // 7. Rate limit
  const key = params.voterToken ?? params.clientIp ?? "unknown";
  if (!checkRateLimit(key)) {
    throw new (await import("../lib/errors")).AppError(
      429,
      "Rate limit exceeded",
      "RATE_LIMITED",
    );
  }
}

// ── Submit ────────────────────────────────────────────────────────────────────

/**
 * Sign and submit castVote to the chain.  Returns the transaction hash.
 * If the tx reverts, the error is re-thrown as an AppError(400).
 */
export async function submitRelay(
  eventAddr: string,
  raceId: bigint,
  pubSignals: bigint[],
  proof: bigint[],
): Promise<string> {
  const wallet = getRelayerWallet();
  const contract = new ethers.Contract(eventAddr, VOTING_CONTRACT_ABI, wallet);

  let tx: ethers.TransactionResponse;
  try {
    tx = await contract.castVote(
      raceId,
      pubSignals as Parameters<typeof contract.castVote>[1],
      proof as Parameters<typeof contract.castVote>[2],
    ) as ethers.TransactionResponse;
  } catch (err: unknown) {
    throw internal(`Failed to submit castVote: ${(err as Error).message}`);
  }

  let receipt: ethers.TransactionReceipt | null;
  try {
    receipt = await tx.wait();
  } catch (err: unknown) {
    // Transaction reverted on-chain — decode the reason if possible
    const msg = (err as Error).message ?? "Transaction reverted";
    throw badRequest(`castVote reverted: ${msg}`, "PROOF_REJECTED");
  }

  if (!receipt || receipt.status === 0) {
    throw badRequest("castVote transaction failed (status=0)", "PROOF_REJECTED");
  }

  return receipt.hash;
}
