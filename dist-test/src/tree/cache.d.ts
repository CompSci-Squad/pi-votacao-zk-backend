import { PoseidonTree } from "./builder";
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
export declare function getCachedTree(eventAddr: string, latestBlock: number): Promise<PoseidonTree>;
/** Flush all cached trees (test helper). */
export declare function _flushTreeCache(): void;
//# sourceMappingURL=cache.d.ts.map