export interface PendingEntry {
    /** Unix timestamp (ms) when the proof was received. */
    ts: number;
    /** VotingEvent contract address. */
    eventAddr: string;
    /** sha256 of the proof array joined with commas. */
    proofHash: string;
    /** pubSignals[1] — the anonymised voter token for this vote. */
    nullifier: string;
    /** pubSignals[4] */
    raceId: string;
    /** pubSignals[5] */
    pickIndex: string;
    /** True once the castVote tx was mined. */
    submitted: boolean;
    /** txHash if submitted. */
    txHash?: string;
}
export interface EpochRecord {
    epochNum: number;
    startTs: number;
    endTs: number;
    entries: PendingEntry[];
    /** sha256 of the JSON-serialized entries (tamper-evident root). */
    root: string;
}
/**
 * Append a received (but not yet submitted) proof to the current epoch log.
 * Returns the entry so the caller can mutate `submitted` and `txHash` once
 * the tx is mined.
 */
export declare function logReceived(eventAddr: string, pubSignals: bigint[], proof: bigint[]): PendingEntry;
/** Mark a previously logged entry as submitted once a txHash is available. */
export declare function markSubmitted(entry: PendingEntry, txHash: string): void;
/**
 * Check whether the given nullifier already appears in the current epoch's
 * in-memory buffer (the "pending" state — received but tx not yet mined).
 * Used as a cheap pre-check in the relay guard to avoid duplicate submissions.
 */
export declare function isNullifierPending(eventAddr: string, nullifier: string): boolean;
/** Return the current epoch's entries, optionally filtered by eventAddr. */
export declare function currentEpochEntries(eventAddr?: string): PendingEntry[];
/** Return all ring-buffer epochs, optionally filtered by eventAddr. */
export declare function allEpochRecords(eventAddr?: string): EpochRecord[];
/** Start the epoch-rotation timer. Call once at server startup. */
export declare function startPendingLog(): void;
/** Stop the timer and flush the current epoch (call at graceful shutdown). */
export declare function stopPendingLog(): Promise<void>;
export declare function _resetPendingLogForTests(): void;
//# sourceMappingURL=pendingLog.d.ts.map