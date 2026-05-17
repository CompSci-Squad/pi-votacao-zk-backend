import { ethers } from "ethers";
export interface EventSummary {
    eventId: string;
    address: string;
    name: string;
    admin: string;
    createdAtBlock: number;
}
/**
 * List all VotingEvents ever created by the factory.
 * Results are cached for 30 seconds to avoid repeated eth_getLogs calls.
 */
export declare function listEvents(force?: boolean): Promise<EventSummary[]>;
/**
 * Return the canonical set of known VotingEvent addresses (lowercased).
 * Used by the relay guard to validate the event address in the request.
 */
export declare function knownEventAddresses(): Promise<Set<string>>;
/**
 * Look up a single event by its contract address.
 * Returns undefined if the address is not a known VotingEvent.
 */
export declare function eventByAddress(addr: string): Promise<EventSummary | undefined>;
/**
 * Call factory.auditAnchor(root) signed by the relayer wallet.
 * Only relevant when AUDIT_ANCHOR_ENABLED=true.
 */
export declare function publishAuditAnchor(root: string, signer: ethers.Signer): Promise<string>;
/** Invalidate the cache (test helper). */
export declare function _invalidateCache(): void;
//# sourceMappingURL=factory.d.ts.map