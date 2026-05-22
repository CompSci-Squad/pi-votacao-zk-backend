"use strict";

/**
 * admin.ts
 *
 * Wrappers for all admin (state-changing) on-chain operations.
 *
 * All functions sign with the ADMIN_PRIVATE_KEY (falls back to
 * RELAYER_PRIVATE_KEY if not set).  In local dev these are the same anvil
 * account that deployed the contracts.
 *
 * In production:
 *   - RELAYER_PRIVATE_KEY should be a hot wallet that only calls castVote.
 *   - ADMIN_PRIVATE_KEY should be a separate wallet held by the election
 *     authority (used for setup / state transitions).
 */

import { ethers } from "ethers";
import { VOTING_CONTRACT_ABI, VOTING_FACTORY_ABI } from "../lib/abis";
import { getProvider } from "./provider";
import { config } from "../config";
import { notConfigured } from "../lib/errors";

// ── Signer ────────────────────────────────────────────────────────────────────

/** Returns the admin signer wallet. */
export function getAdminWallet(): ethers.Wallet {
  return new ethers.Wallet(config.adminPrivateKey, getProvider());
}

function signedFactory(): ethers.Contract {
  if (!config.factoryAddress) throw notConfigured("FACTORY_ADDRESS");
  return new ethers.Contract(
    config.factoryAddress,
    VOTING_FACTORY_ABI as unknown as ethers.InterfaceAbi,
    getAdminWallet(),
  );
}

function signedContract(addr: string): ethers.Contract {
  return new ethers.Contract(
    addr,
    VOTING_CONTRACT_ABI as unknown as ethers.InterfaceAbi,
    getAdminWallet(),
  );
}

interface TxReceipt {
  txHash: string;
  blockNumber: number;
}

async function send(
  tx: Promise<ethers.ContractTransactionResponse>,
): Promise<TxReceipt> {
  const response = await tx;
  const receipt = await response.wait();
  if (!receipt) throw new Error("Transaction receipt is null");
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

// ── Factory operations ────────────────────────────────────────────────────────

export interface DeployResult extends TxReceipt {
  /** Address of the freshly deployed VotingContract. */
  address: string;
}

/**
 * Deploy a new VotingContract via VotingFactory.createEvent().
 * Seeds election metadata and transfers admin to the caller's address.
 */
export async function deployElection(
  name: string,
  description: string,
): Promise<DeployResult> {
  const factory = signedFactory();
  const response = await (factory.createEvent as (
    n: string,
    d: string,
    o: object,
  ) => Promise<ethers.ContractTransactionResponse>)(name, description, {
    gasLimit: 3_000_000,
  });
  const receipt = await response.wait();
  if (!receipt) throw new Error("Transaction receipt is null");

  const iface = new ethers.Interface(
    VOTING_FACTORY_ABI as unknown as string[],
  );
  let eventAddress = "";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "EventCreated") {
        eventAddress = parsed.args[2] as string;
        break;
      }
    } catch {
      // skip non-matching logs
    }
  }
  if (!eventAddress) throw new Error("EventCreated log not found in receipt");

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    address: eventAddress,
  };
}

// ── VotingContract write operations ───────────────────────────────────────────

/**
 * Add a candidate to a race.
 * raceId 0 = the default single-race slot (PoC legacy).
 * raceId ≥ 1 = extra races created with addRace().
 */
export function addCandidateToRace(
  addr: string,
  raceId: number,
  name: string,
  party: string,
  candidateNumber: bigint,
): Promise<TxReceipt> {
  return send(
    signedContract(addr).addCandidateToRace(
      raceId,
      name,
      party,
      candidateNumber,
      { gasLimit: 300_000 },
    ) as Promise<ethers.ContractTransactionResponse>,
  );
}

/** Create a new race (raceId ≥ 1).  Race 0 always exists. */
export async function addRace(
  addr: string,
  name: string,
): Promise<TxReceipt & { raceId: number }> {
  const response = await (
    signedContract(addr).addRace(name, {
      gasLimit: 200_000,
    }) as Promise<ethers.ContractTransactionResponse>
  );
  const receipt = await response.wait();
  if (!receipt) throw new Error("Transaction receipt is null");

  // Parse RaceAdded event to get the new raceId
  const iface = new ethers.Interface(
    VOTING_CONTRACT_ABI as unknown as string[],
  );
  let raceId = -1;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "RaceAdded") {
        raceId = Number(parsed.args[0]);
        break;
      }
    } catch {
      // skip
    }
  }

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, raceId };
}

/** Set the display name of race 0 (may only be called while PENDING). */
export function setRace0Name(addr: string, name: string): Promise<TxReceipt> {
  return send(
    signedContract(addr).setRace0Name(name, {
      gasLimit: 100_000,
    }) as Promise<ethers.ContractTransactionResponse>,
  );
}

/** Set the maxPicks for any race (PENDING only). */
export function setRaceMaxPicks(
  addr: string,
  raceId: number,
  maxPicks: number,
): Promise<TxReceipt> {
  return send(
    signedContract(addr).setRaceMaxPicks(raceId, maxPicks, {
      gasLimit: 100_000,
    }) as Promise<ethers.ContractTransactionResponse>,
  );
}

/** Register voter identity hashes (Poseidon(voter_id)). PENDING only. */
export function registerVoterHashes(
  addr: string,
  hashes: bigint[],
): Promise<TxReceipt> {
  return send(
    signedContract(addr).registerVoterHashes(hashes, {
      gasLimit: 500_000,
    }) as Promise<ethers.ContractTransactionResponse>,
  );
}

/** Set the Merkle root of the voter set. Requires hashes to be registered first. */
export function setMerkleRoot(
  addr: string,
  root: bigint,
): Promise<TxReceipt> {
  return send(
    signedContract(addr).setMerkleRoot(root, {
      gasLimit: 100_000,
    }) as Promise<ethers.ContractTransactionResponse>,
  );
}

/** Transition PENDING → OPEN. */
export function openElection(addr: string): Promise<TxReceipt> {
  return send(
    signedContract(addr).openElection({
      gasLimit: 100_000,
    }) as Promise<ethers.ContractTransactionResponse>,
  );
}

/** Transition OPEN → FINISHED. */
export function closeElection(addr: string): Promise<TxReceipt> {
  return send(
    signedContract(addr).closeElection({
      gasLimit: 100_000,
    }) as Promise<ethers.ContractTransactionResponse>,
  );
}
