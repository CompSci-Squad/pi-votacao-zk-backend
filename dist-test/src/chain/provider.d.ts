import { ethers } from "ethers";
/**
 * Return a shared JsonRpcProvider.
 *
 * batchMaxCount: 1 prevents the ethers v6 default batching behaviour where two
 * sequential awaits (e.g. two deploys in the same tick) can share a single
 * eth_getTransactionCount request and produce duplicate nonces. This matches
 * the fix applied in the blockchain repo's integration suite (SESSION_LOG
 * 2026-04-25).
 */
export declare function getProvider(): ethers.JsonRpcProvider;
/** Replace the provider (test helper — lets integration tests inject a local provider). */
export declare function setProvider(p: ethers.JsonRpcProvider): void;
/** Reset the singleton (test helper). */
export declare function _resetProviderForTests(): void;
//# sourceMappingURL=provider.d.ts.map