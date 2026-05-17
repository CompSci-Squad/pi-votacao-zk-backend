import { ethers } from "ethers";
export declare enum ElectionState {
    PENDING = 0,
    OPEN = 1,
    FINISHED = 2
}
export declare function stateLabel(s: number): string;
export interface Candidate {
    id: bigint;
    name: string;
    party: string;
    number: bigint;
    voteCount: bigint;
}
export interface RaceSnapshot {
    raceId: bigint;
    name: string;
    candidates: Candidate[];
    blankVotes: bigint;
    nullVotes: bigint;
    totalVotes: bigint;
}
export interface EventState {
    address: string;
    electionName: string;
    electionDescription: string;
    admin: string;
    state: number;
    stateLabel: string;
    currentElectionId: bigint;
    voterMerkleRoot: bigint;
    racesCount: bigint;
    race0Name: string;
}
export interface RaceInfo {
    raceId: number;
    name: string;
    maxPicks: number;
    candidates: Candidate[];
}
export interface BoletimUrna {
    electionName: string;
    electionId: bigint;
    state: number;
    snapshots: RaceSnapshot[];
    voterCount: bigint;
    merkleRoot: bigint;
    grandTotalVotes: bigint;
    blockTimestamp: bigint;
    blockNumber: bigint;
}
export declare function getVotingContract(addr: string): ethers.Contract;
/**
 * Fetch top-level event state (name, description, admin, state, merkle root, …).
 */
export declare function readEventState(addr: string): Promise<EventState>;
/**
 * Fetch all races with their candidates and configuration.
 */
export declare function readRaces(addr: string): Promise<RaceInfo[]>;
/**
 * Return all voter commitments (Poseidon(voter_id) values) in leaf-index order,
 * sourced from on-chain VoterEnrolled events.
 *
 * Indexed event: VoterEnrolled(uint256 indexed commitment, uint256 indexed leafIndex)
 */
export declare function readVoterCommitments(addr: string): Promise<{
    commitment: bigint;
    leafIndex: number;
}[]>;
/**
 * Return all VoteCast events for an event (for the RDV audit document).
 */
export interface VoteCastLog {
    nullifier: bigint;
    raceId: bigint;
    candidateId: bigint;
    pickIndex: number;
    txHash: string;
    blockNumber: number;
}
export declare function readVoteCastLogs(addr: string): Promise<VoteCastLog[]>;
/** Check whether a nullifier has been spent for a given race. */
export declare function isNullifierUsed(addr: string, raceId: bigint, nullifier: bigint): Promise<boolean>;
/** Fetch the multi-race Boletim de Urna. Available in any state. */
export declare function readBoletimUrna(addr: string): Promise<BoletimUrna>;
//# sourceMappingURL=event.d.ts.map