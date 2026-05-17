"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedTree = getCachedTree;
exports._flushTreeCache = _flushTreeCache;
const builder_1 = require("./builder");
const event_1 = require("../chain/event");
/** Cache keyed by `${eventAddr}:${latestBlock}`. Max 50 entries. */
const _cache = new Map();
const MAX_ENTRIES = 50;
const TTL_MS = 60_000; // 1 minute
function evictIfFull() {
    if (_cache.size < MAX_ENTRIES)
        return;
    // Evict the oldest entry (insertion-order iteration of Map)
    const firstKey = _cache.keys().next().value;
    if (firstKey)
        _cache.delete(firstKey);
}
function cacheKey(eventAddr, latestBlock) {
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
async function getCachedTree(eventAddr, latestBlock) {
    const key = cacheKey(eventAddr, latestBlock);
    const entry = _cache.get(key);
    if (entry && Date.now() - entry.fetchedAt < TTL_MS) {
        return entry.tree;
    }
    const commitments = await (0, event_1.readVoterCommitments)(eventAddr);
    const tree = await (0, builder_1.buildTree)(commitments);
    evictIfFull();
    _cache.set(key, { tree, latestBlock, fetchedAt: Date.now() });
    return tree;
}
/** Flush all cached trees (test helper). */
function _flushTreeCache() {
    _cache.clear();
}
//# sourceMappingURL=cache.js.map