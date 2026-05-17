"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEvents = listEvents;
exports.knownEventAddresses = knownEventAddresses;
exports.eventByAddress = eventByAddress;
exports.publishAuditAnchor = publishAuditAnchor;
exports._invalidateCache = _invalidateCache;
const ethers_1 = require("ethers");
const abis_1 = require("../lib/abis");
const provider_1 = require("./provider");
const config_1 = require("../config");
const errors_1 = require("../lib/errors");
/** Cache: [events list, fetched at timestamp] */
let _cache = null;
const CACHE_TTL_MS = 30_000;
function getFactory() {
    if (!config_1.config.factoryAddress)
        throw (0, errors_1.notConfigured)("FACTORY_ADDRESS");
    return new ethers_1.ethers.Contract(config_1.config.factoryAddress, abis_1.VOTING_FACTORY_ABI, (0, provider_1.getProvider)());
}
/**
 * List all VotingEvents ever created by the factory.
 * Results are cached for 30 seconds to avoid repeated eth_getLogs calls.
 */
async function listEvents(force = false) {
    const now = Date.now();
    if (!force && _cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
        return _cache.events;
    }
    const factory = getFactory();
    const filter = factory.filters.EventCreated();
    const logs = await factory.queryFilter(filter, 0, "latest");
    const events = logs.map((log) => {
        const parsed = log;
        return {
            eventId: parsed.args.eventId.toString(),
            address: parsed.args.eventAddress,
            name: parsed.args.name,
            admin: parsed.args.admin,
            createdAtBlock: parsed.blockNumber,
        };
    });
    _cache = { events, fetchedAt: now };
    return events;
}
/**
 * Return the canonical set of known VotingEvent addresses (lowercased).
 * Used by the relay guard to validate the event address in the request.
 */
async function knownEventAddresses() {
    const list = await listEvents();
    return new Set(list.map((e) => e.address.toLowerCase()));
}
/**
 * Look up a single event by its contract address.
 * Returns undefined if the address is not a known VotingEvent.
 */
async function eventByAddress(addr) {
    const list = await listEvents();
    return list.find((e) => e.address.toLowerCase() === addr.toLowerCase());
}
/**
 * Call factory.auditAnchor(epoch, root) signed by the relayer wallet.
 * Only relevant when AUDIT_ANCHOR_ENABLED=true.
 */
async function publishAuditAnchor(root, signer, epoch) {
    const factory = getFactory();
    const connected = factory.connect(signer);
    const epochVal = epoch ?? Math.floor(Date.now() / 1000);
    const tx = await connected.auditAnchor(epochVal, root);
    const receipt = await tx.wait();
    return receipt.hash;
}
/** Invalidate the cache (test helper). */
function _invalidateCache() {
    _cache = null;
}
//# sourceMappingURL=factory.js.map