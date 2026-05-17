"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultRelayGuardsDeps = void 0;
exports.getRelayerWallet = getRelayerWallet;
exports.setRelayerWallet = setRelayerWallet;
exports._resetRelayerForTests = _resetRelayerForTests;
exports.checkRateLimit = checkRateLimit;
exports._flushRateBuckets = _flushRateBuckets;
exports.validateRelayRequest = validateRelayRequest;
exports.submitRelay = submitRelay;
const ethers_1 = require("ethers");
const abis_1 = require("../lib/abis");
const provider_1 = require("./provider");
const config_1 = require("../config");
const errors_1 = require("../lib/errors");
const factory_1 = require("./factory");
const event_1 = require("./event");
// ── Relayer wallet singleton ──────────────────────────────────────────────────
let _wallet = null;
function getRelayerWallet() {
    if (!_wallet) {
        _wallet = new ethers_1.ethers.Wallet(config_1.config.relayerPrivateKey, (0, provider_1.getProvider)());
    }
    return _wallet;
}
/** Test helper — inject a pre-funded wallet without touching process.env. */
function setRelayerWallet(w) {
    _wallet = w;
}
function _resetRelayerForTests() {
    _wallet = null;
}
const _rateBuckets = new Map();
/**
 * Check and consume one token from the rate bucket for key.
 * Returns false if the rate limit has been exceeded.
 */
function checkRateLimit(key) {
    const now = Date.now();
    const bucket = _rateBuckets.get(key);
    if (!bucket || now - bucket.windowStart > config_1.config.rateWindowMs) {
        _rateBuckets.set(key, { count: 1, windowStart: now });
        return true;
    }
    if (bucket.count >= config_1.config.rateLimitCount)
        return false;
    bucket.count++;
    return true;
}
/** Flush all buckets (test helper). */
function _flushRateBuckets() {
    _rateBuckets.clear();
}
/** Default production deps — talk to the real chain. */
exports.defaultRelayGuardsDeps = {
    async isKnownEvent(addr) {
        const known = await (0, factory_1.knownEventAddresses)();
        return known.has(addr.toLowerCase());
    },
    async getElectionId(addr) {
        const s = await (0, event_1.readEventState)(addr);
        return s.currentElectionId;
    },
    async getElectionState(addr) {
        const s = await (0, event_1.readEventState)(addr);
        return s.state;
    },
    async getRacesCount(addr) {
        const s = await (0, event_1.readEventState)(addr);
        return s.racesCount;
    },
    async checkNullifierUsed(addr, raceId, nullifier) {
        return (0, event_1.isNullifierUsed)(addr, raceId, nullifier);
    },
};
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
async function validateRelayRequest(params, deps = exports.defaultRelayGuardsDeps) {
    const { eventAddr, raceId, pubSignals } = params;
    // 1. Event registered
    if (!(await deps.isKnownEvent(eventAddr))) {
        throw (0, errors_1.badRequest)(`${eventAddr} is not a VotingEvent deployed by the factory`, "UNKNOWN_EVENT");
    }
    // 2. Election is OPEN
    const stateNum = await deps.getElectionState(eventAddr);
    if (stateNum !== event_1.ElectionState.OPEN) {
        throw (0, errors_1.badRequest)(`Election is not OPEN (current state: ${event_1.ElectionState[stateNum] ?? stateNum})`, "ELECTION_NOT_OPEN");
    }
    // 3. election_id matches pubSignals[3]
    const onChainElectionId = await deps.getElectionId(eventAddr);
    const signalElectionId = pubSignals[3];
    if (signalElectionId !== onChainElectionId) {
        throw (0, errors_1.badRequest)(`pubSignals[3] election_id (${signalElectionId}) does not match on-chain electionId (${onChainElectionId})`, "INVALID_ELECTION_ID");
    }
    // 4. race_id matches raceId param
    const signalRaceId = pubSignals[4];
    if (signalRaceId !== raceId) {
        throw (0, errors_1.badRequest)(`pubSignals[4] race_id (${signalRaceId}) does not match raceId param (${raceId})`, "RACE_ID_MISMATCH");
    }
    // 5. raceId < racesCount
    const racesCount = await deps.getRacesCount(eventAddr);
    if (raceId >= racesCount) {
        throw (0, errors_1.badRequest)(`raceId ${raceId} is out of range (racesCount=${racesCount})`, "INVALID_RACE_ID");
    }
    // 6. Nullifier not already used (pre-check)
    const nullifier = pubSignals[1];
    if (await deps.checkNullifierUsed(eventAddr, raceId, nullifier)) {
        throw (0, errors_1.conflict)("Nullifier already used", "NULLIFIER_USED");
    }
    // 7. Rate limit
    const key = params.voterToken ?? params.clientIp ?? "unknown";
    if (!checkRateLimit(key)) {
        throw new (await Promise.resolve().then(() => __importStar(require("../lib/errors")))).AppError(429, "Rate limit exceeded", "RATE_LIMITED");
    }
}
// ── Submit ────────────────────────────────────────────────────────────────────
/**
 * Sign and submit castVote to the chain.  Returns the transaction hash.
 * If the tx reverts, the error is re-thrown as an AppError(400).
 */
async function submitRelay(eventAddr, raceId, pubSignals, proof) {
    const wallet = getRelayerWallet();
    const contract = new ethers_1.ethers.Contract(eventAddr, abis_1.VOTING_CONTRACT_ABI, wallet);
    let tx;
    try {
        tx = await contract.castVote(raceId, pubSignals, proof);
    }
    catch (err) {
        throw (0, errors_1.internal)(`Failed to submit castVote: ${err.message}`);
    }
    let receipt;
    try {
        receipt = await tx.wait();
    }
    catch (err) {
        // Transaction reverted on-chain — decode the reason if possible
        const msg = err.message ?? "Transaction reverted";
        throw (0, errors_1.badRequest)(`castVote reverted: ${msg}`, "PROOF_REJECTED");
    }
    if (!receipt || receipt.status === 0) {
        throw (0, errors_1.badRequest)("castVote transaction failed (status=0)", "PROOF_REJECTED");
    }
    return receipt.hash;
}
//# sourceMappingURL=relayer.js.map