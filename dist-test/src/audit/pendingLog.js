"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logReceived = logReceived;
exports.markSubmitted = markSubmitted;
exports.isNullifierPending = isNullifierPending;
exports.currentEpochEntries = currentEpochEntries;
exports.allEpochRecords = allEpochRecords;
exports.startPendingLog = startPendingLog;
exports.stopPendingLog = stopPendingLog;
exports._resetPendingLogForTests = _resetPendingLogForTests;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const config_1 = require("../config");
const factory_1 = require("../chain/factory");
const relayer_1 = require("../chain/relayer");
// ── State ─────────────────────────────────────────────────────────────────────
let _currentEpoch = 0;
let _epochStart = Date.now();
/** in-memory ring buffer: last RING_SIZE epochs */
const RING_SIZE = 12; // 1 hour at 5-min windows
const _ring = new Map();
const _current = [];
let _timer = null;
// ── Helpers ───────────────────────────────────────────────────────────────────
function epochRoot(entries) {
    const json = JSON.stringify(entries);
    return (0, crypto_1.createHash)("sha256").update(json).digest("hex");
}
async function rotateEpoch() {
    const now = Date.now();
    const record = {
        epochNum: _currentEpoch,
        startTs: _epochStart,
        endTs: now,
        entries: [..._current],
        root: epochRoot(_current),
    };
    // Persist to disk
    try {
        (0, fs_1.mkdirSync)(config_1.config.pendingLogDir, { recursive: true });
        const file = (0, path_1.join)(config_1.config.pendingLogDir, `epoch_${_currentEpoch}.json`);
        (0, fs_1.writeFileSync)(file, JSON.stringify(record, null, 2), "utf8");
    }
    catch (_err) {
        // Non-fatal: log failure is a monitoring issue, not a correctness one
    }
    // Update ring buffer
    _ring.set(_currentEpoch, record);
    if (_ring.size > RING_SIZE) {
        const oldest = Math.min(..._ring.keys());
        _ring.delete(oldest);
    }
    // Publish on-chain anchor (optional)
    if (config_1.config.auditAnchorEnabled && record.entries.length > 0) {
        try {
            const rootBytes = `0x${record.root}`;
            await (0, factory_1.publishAuditAnchor)(rootBytes, (0, relayer_1.getRelayerWallet)());
        }
        catch (_err) {
            // Non-fatal — the file on disk is the primary evidence
        }
    }
    // Advance epoch
    _current.length = 0;
    _currentEpoch++;
    _epochStart = now;
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Append a received (but not yet submitted) proof to the current epoch log.
 * Returns the entry so the caller can mutate `submitted` and `txHash` once
 * the tx is mined.
 */
function logReceived(eventAddr, pubSignals, proof) {
    const proofHash = (0, crypto_1.createHash)("sha256")
        .update(proof.map(String).join(","))
        .digest("hex");
    const entry = {
        ts: Date.now(),
        eventAddr: eventAddr.toLowerCase(),
        proofHash,
        nullifier: pubSignals[1].toString(),
        raceId: pubSignals[4].toString(),
        pickIndex: pubSignals[5].toString(),
        submitted: false,
    };
    _current.push(entry);
    return entry;
}
/** Mark a previously logged entry as submitted once a txHash is available. */
function markSubmitted(entry, txHash) {
    entry.submitted = true;
    entry.txHash = txHash;
}
/**
 * Check whether the given nullifier already appears in the current epoch's
 * in-memory buffer (the "pending" state — received but tx not yet mined).
 * Used as a cheap pre-check in the relay guard to avoid duplicate submissions.
 */
function isNullifierPending(eventAddr, nullifier) {
    const addr = eventAddr.toLowerCase();
    return _current.some((e) => e.eventAddr === addr && e.nullifier === nullifier && !e.submitted);
}
/** Return the current epoch's entries, optionally filtered by eventAddr. */
function currentEpochEntries(eventAddr) {
    if (!eventAddr)
        return [..._current];
    const addr = eventAddr.toLowerCase();
    return _current.filter((e) => e.eventAddr === addr);
}
/** Return all ring-buffer epochs, optionally filtered by eventAddr. */
function allEpochRecords(eventAddr) {
    const records = Array.from(_ring.values()).sort((a, b) => a.epochNum - b.epochNum);
    if (!eventAddr)
        return records;
    const addr = eventAddr.toLowerCase();
    return records.map((r) => ({
        ...r,
        entries: r.entries.filter((e) => e.eventAddr === addr),
    }));
}
// ── Lifecycle ─────────────────────────────────────────────────────────────────
/** Start the epoch-rotation timer. Call once at server startup. */
function startPendingLog() {
    if (_timer)
        return;
    _timer = setInterval(() => {
        rotateEpoch().catch(() => {
            /* swallow — non-fatal */
        });
    }, config_1.config.epochWindowMs);
    _timer.unref(); // don't prevent process exit
}
/** Stop the timer and flush the current epoch (call at graceful shutdown). */
async function stopPendingLog() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    await rotateEpoch();
}
// ── Test helpers ──────────────────────────────────────────────────────────────
function _resetPendingLogForTests() {
    _current.length = 0;
    _ring.clear();
    _currentEpoch = 0;
    _epochStart = Date.now();
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}
//# sourceMappingURL=pendingLog.js.map