import { ethers } from "ethers";
export declare function getRelayerWallet(): ethers.Wallet;
/** Test helper — inject a pre-funded wallet without touching process.env. */
export declare function setRelayerWallet(w: ethers.Wallet): void;
export declare function _resetRelayerForTests(): void;
/**
 * Check and consume one token from the rate bucket for key.
 * Returns false if the rate limit has been exceeded.
 */
export declare function checkRateLimit(key: string): boolean;
/** Flush all buckets (test helper). */
export declare function _flushRateBuckets(): void;
export interface RelayGuardsDeps {
    isKnownEvent(addr: string): Promise<boolean>;
    getElectionId(addr: string): Promise<bigint>;
    getElectionState(addr: string): Promise<number>;
    getRacesCount(addr: string): Promise<bigint>;
    checkNullifierUsed(addr: string, raceId: bigint, nullifier: bigint): Promise<boolean>;
}
/** Default production deps — talk to the real chain. */
export declare const defaultRelayGuardsDeps: RelayGuardsDeps;
export interface RelayParams {
    eventAddr: string;
    raceId: bigint;
    pubSignals: bigint[];
    proof: bigint[];
    voterToken?: string;
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
export declare function validateRelayRequest(params: RelayParams, deps?: RelayGuardsDeps): Promise<void>;
/**
 * Sign and submit castVote to the chain.  Returns the transaction hash.
 * If the tx reverts, the error is re-thrown as an AppError(400).
 */
export declare function submitRelay(eventAddr: string, raceId: bigint, pubSignals: bigint[], proof: bigint[]): Promise<string>;
//# sourceMappingURL=relayer.d.ts.map