export interface ZeresimaDocument {
    type: "ZERESIMA";
    eventAddr: string;
    electionName: string;
    electionId: string;
    state: string;
    snapshots: unknown[];
    voterCount: string;
    merkleRoot: string;
    allZero: boolean;
    blockTimestamp: string;
    blockNumber: string;
    generatedAtIso: string;
    sha256: string;
}
/**
 * Fetch the multi-race Zerésima from the VotingContract.
 * Only available while the election is in PENDING state.
 * Returns a self-describing JSON document with a sha256 digest.
 */
export declare function buildZeresima(eventAddr: string): Promise<ZeresimaDocument>;
//# sourceMappingURL=zeresima.d.ts.map