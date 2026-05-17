export interface RdvEntry {
    nullifier: string;
    raceId: string;
    candidateId: string;
    pickIndex: number;
    txHash: string;
    blockNumber: number;
}
export interface RdvDocument {
    type: "RDV";
    eventAddr: string;
    voteCount: number;
    votes: RdvEntry[];
    generatedAtIso: string;
    sha256: string;
}
/**
 * Build the Registro Digital de Voto (RDV) — a log of every cast vote,
 * sourced from on-chain VoteCast events.
 *
 * Each entry contains the nullifier (anonymous voter token), race, and
 * candidate. No voter identity is exposed. The document is byte-identical
 * to any re-computation from the same chain state (deterministic).
 */
export declare function buildRdv(eventAddr: string): Promise<RdvDocument>;
//# sourceMappingURL=rdv.d.ts.map