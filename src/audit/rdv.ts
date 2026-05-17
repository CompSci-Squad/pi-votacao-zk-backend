"use strict";

import { createHash } from "crypto";
import { readVoteCastLogs } from "../chain/event";
import { toSafeJson } from "../lib/serialize";

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
export async function buildRdv(eventAddr: string): Promise<RdvDocument> {
  const logs = await readVoteCastLogs(eventAddr);

  const votes: RdvEntry[] = logs.map((log) => ({
    nullifier: log.nullifier.toString(),
    raceId: log.raceId.toString(),
    candidateId: log.candidateId.toString(),
    pickIndex: log.pickIndex,
    txHash: log.txHash,
    blockNumber: log.blockNumber,
  }));

  const body = toSafeJson({
    type: "RDV",
    eventAddr,
    voteCount: votes.length,
    votes,
    generatedAtIso: new Date().toISOString(),
  }) as Omit<RdvDocument, "sha256">;

  const json = JSON.stringify(body);
  const sha256 = createHash("sha256").update(json).digest("hex");

  return { ...(body as RdvDocument), sha256 };
}
