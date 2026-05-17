export interface BoletimUrnaDocument {
    type: "BOLETIM_DE_URNA";
    eventAddr: string;
    electionName: string;
    electionId: string;
    state: string;
    snapshots: unknown[];
    voterCount: string;
    merkleRoot: string;
    grandTotalVotes: string;
    blockTimestamp: string;
    blockNumber: string;
    generatedAtIso: string;
    sha256: string;
}
/**
 * Fetch and return the Boletim de Urna (vote tally) document.
 * Available in any election state; semantically meant to be called
 * after closeElection(), but returning live partial results during
 * OPEN is valid and useful for observers.
 */
export declare function buildBoletimUrna(eventAddr: string): Promise<BoletimUrnaDocument>;
//# sourceMappingURL=bu.d.ts.map