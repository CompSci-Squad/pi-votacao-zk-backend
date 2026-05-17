"use strict";

import { ethers } from "ethers";
import { VOTING_FACTORY_ABI } from "../lib/abis";
import { getProvider } from "./provider";
import { config } from "../config";
import { notConfigured } from "../lib/errors";

export interface EventSummary {
  eventId: string;
  address: string;
  name: string;
  admin: string;
  createdAtBlock: number;
}

/** Cache: [events list, fetched at timestamp] */
let _cache: { events: EventSummary[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

function getFactory(): ethers.Contract {
  if (!config.factoryAddress) throw notConfigured("FACTORY_ADDRESS");
  return new ethers.Contract(config.factoryAddress, VOTING_FACTORY_ABI, getProvider());
}

/**
 * List all VotingEvents ever created by the factory.
 * Results are cached for 30 seconds to avoid repeated eth_getLogs calls.
 */
export async function listEvents(force = false): Promise<EventSummary[]> {
  const now = Date.now();
  if (!force && _cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.events;
  }

  const factory = getFactory();
  const filter = factory.filters.EventCreated();
  const logs = await factory.queryFilter(filter, 0, "latest");

  const events: EventSummary[] = logs.map((log) => {
    const parsed = log as ethers.EventLog;
    return {
      eventId: (parsed.args.eventId as bigint).toString(),
      address: parsed.args.eventAddress as string,
      name: parsed.args.name as string,
      admin: parsed.args.admin as string,
      createdAtBlock: parsed.blockNumber,
    };
  });

  _cache = { events, fetchedAt: now };
  return events;
}

/**
 * Return the canonical set of known VotingEvent addresses (lowercased).
 * Used by the relay guard to validate the event address in the request.
 */
export async function knownEventAddresses(): Promise<Set<string>> {
  const list = await listEvents();
  return new Set(list.map((e) => e.address.toLowerCase()));
}

/**
 * Look up a single event by its contract address.
 * Returns undefined if the address is not a known VotingEvent.
 */
export async function eventByAddress(
  addr: string,
): Promise<EventSummary | undefined> {
  const list = await listEvents();
  return list.find((e) => e.address.toLowerCase() === addr.toLowerCase());
}

/**
 * Call factory.auditAnchor(epoch, root) signed by the relayer wallet.
 * Only relevant when AUDIT_ANCHOR_ENABLED=true.
 */
export async function publishAuditAnchor(
  root: string,
  signer: ethers.Signer,
  epoch?: number,
): Promise<string> {
  const factory = getFactory();
  const connected = factory.connect(signer);
  const epochVal = epoch ?? Math.floor(Date.now() / 1000);
  const tx = await (connected as ethers.Contract).auditAnchor(epochVal, root);
  const receipt = await (tx as ethers.TransactionResponse).wait();
  return (receipt as ethers.TransactionReceipt).hash;
}

/** Invalidate the cache (test helper). */
export function _invalidateCache(): void {
  _cache = null;
}
