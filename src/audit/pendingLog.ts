"use strict";

import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { config } from "../config";
import { publishAuditAnchor } from "../chain/factory";
import { getRelayerWallet } from "../chain/relayer";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── State ─────────────────────────────────────────────────────────────────────

let _currentEpoch = 0;
let _epochStart = Date.now();
/** in-memory ring buffer: last RING_SIZE epochs */
const RING_SIZE = 12; // 1 hour at 5-min windows
const _ring: Map<number, EpochRecord> = new Map();
const _current: PendingEntry[] = [];

let _timer: ReturnType<typeof setInterval> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function epochRoot(entries: PendingEntry[]): string {
  const json = JSON.stringify(entries);
  return createHash("sha256").update(json).digest("hex");
}

async function rotateEpoch(): Promise<void> {
  const now = Date.now();
  const record: EpochRecord = {
    epochNum: _currentEpoch,
    startTs: _epochStart,
    endTs: now,
    entries: [..._current],
    root: epochRoot(_current),
  };

  // Persist to disk
  try {
    mkdirSync(config.pendingLogDir, { recursive: true });
    const file = join(
      config.pendingLogDir,
      `epoch_${_currentEpoch}.json`,
    );
    writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
  } catch (_err) {
    // Non-fatal: log failure is a monitoring issue, not a correctness one
  }

  // Update ring buffer
  _ring.set(_currentEpoch, record);
  if (_ring.size > RING_SIZE) {
    const oldest = Math.min(..._ring.keys());
    _ring.delete(oldest);
  }

  // Publish on-chain anchor (optional)
  if (config.auditAnchorEnabled && record.entries.length > 0) {
    try {
      const rootBytes = `0x${record.root}` as `0x${string}`;
      await publishAuditAnchor(rootBytes, getRelayerWallet());
    } catch (_err) {
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
export function logReceived(
  eventAddr: string,
  pubSignals: bigint[],
  proof: bigint[],
): PendingEntry {
  const proofHash = createHash("sha256")
    .update(proof.map(String).join(","))
    .digest("hex");

  const entry: PendingEntry = {
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
export function markSubmitted(entry: PendingEntry, txHash: string): void {
  entry.submitted = true;
  entry.txHash = txHash;
}

/**
 * Remove a previously logged entry when the relay submission fails.
 * This allows the voter to retry without being blocked by the pending check.
 */
export function markFailed(entry: PendingEntry): void {
  const idx = _current.indexOf(entry);
  if (idx !== -1) _current.splice(idx, 1);
}

/**
 * Check whether the given nullifier already appears in the current epoch's
 * in-memory buffer (the "pending" state — received but tx not yet mined).
 * Used as a cheap pre-check in the relay guard to avoid duplicate submissions.
 */
export function isNullifierPending(
  eventAddr: string,
  nullifier: string,
): boolean {
  const addr = eventAddr.toLowerCase();
  return _current.some(
    (e) => e.eventAddr === addr && e.nullifier === nullifier && !e.submitted,
  );
}

/** Return the current epoch's entries, optionally filtered by eventAddr. */
export function currentEpochEntries(eventAddr?: string): PendingEntry[] {
  if (!eventAddr) return [..._current];
  const addr = eventAddr.toLowerCase();
  return _current.filter((e) => e.eventAddr === addr);
}

/** Return all ring-buffer epochs, optionally filtered by eventAddr. */
export function allEpochRecords(eventAddr?: string): EpochRecord[] {
  const records = Array.from(_ring.values()).sort(
    (a, b) => a.epochNum - b.epochNum,
  );
  if (!eventAddr) return records;
  const addr = eventAddr.toLowerCase();
  return records.map((r) => ({
    ...r,
    entries: r.entries.filter((e) => e.eventAddr === addr),
  }));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** Start the epoch-rotation timer. Call once at server startup. */
export function startPendingLog(): void {
  if (_timer) return;
  _timer = setInterval(() => {
    rotateEpoch().catch(() => {
      /* swallow — non-fatal */
    });
  }, config.epochWindowMs);
  _timer.unref(); // don't prevent process exit
}

/** Stop the timer and flush the current epoch (call at graceful shutdown). */
export async function stopPendingLog(): Promise<void> {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  await rotateEpoch();
}

// ── Test helpers ──────────────────────────────────────────────────────────────

export function _resetPendingLogForTests(): void {
  _current.length = 0;
  _ring.clear();
  _currentEpoch = 0;
  _epochStart = Date.now();
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
