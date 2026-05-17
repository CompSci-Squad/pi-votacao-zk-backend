"use strict";

import { buildTree, PoseidonTree } from "./builder";
import { readVoterCommitments } from "../chain/event";

interface CacheEntry {
  tree: PoseidonTree;
  latestBlock: number;
  fetchedAt: number;
}

/** Cache keyed by `${eventAddr}:${latestBlock}`. Max 50 entries. */
const _cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 50;
const TTL_MS = 60_000; // 1 minute

function evictIfFull(): void {
  if (_cache.size < MAX_ENTRIES) return;
  // Evict the oldest entry (insertion-order iteration of Map)
  const firstKey = _cache.keys().next().value as string | undefined;
  if (firstKey) _cache.delete(firstKey);
}

function cacheKey(eventAddr: string, latestBlock: number): string {
  return `${eventAddr.toLowerCase()}:${latestBlock}`;
}

/**
 * Return a cached Merkle tree for the event, or rebuild it from chain events.
 *
 * The cache key combines (eventAddr, latestBlock) so a new block always
 * triggers a fresh rebuild, but multiple requests within the same block
 * share the expensive Poseidon computation.
 *
 * @param eventAddr  VotingContract address.
 * @param latestBlock  Current block number (from provider.getBlockNumber()).
 */
export async function getCachedTree(
  eventAddr: string,
  latestBlock: number,
): Promise<PoseidonTree> {
  const key = cacheKey(eventAddr, latestBlock);
  const entry = _cache.get(key);

  if (entry && Date.now() - entry.fetchedAt < TTL_MS) {
    return entry.tree;
  }

  const commitments = await readVoterCommitments(eventAddr);
  const tree = await buildTree(commitments);

  evictIfFull();
  _cache.set(key, { tree, latestBlock, fetchedAt: Date.now() });
  return tree;
}

/** Flush all cached trees (test helper). */
export function _flushTreeCache(): void {
  _cache.clear();
}
