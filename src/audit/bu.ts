"use strict";

import { createHash } from "crypto";
import { readBoletimUrna } from "../chain/event";
import { toSafeJson } from "../lib/serialize";

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

const STATE_LABELS = ["PENDING", "OPEN", "FINISHED"];

/**
 * Fetch and return the Boletim de Urna (vote tally) document.
 * Available in any election state; semantically meant to be called
 * after closeElection(), but returning live partial results during
 * OPEN is valid and useful for observers.
 */
export async function buildBoletimUrna(
  eventAddr: string,
): Promise<BoletimUrnaDocument> {
  const bu = await readBoletimUrna(eventAddr);

  const body = toSafeJson({
    type: "BOLETIM_DE_URNA",
    eventAddr,
    electionName: bu.electionName,
    electionId: bu.electionId,
    state: STATE_LABELS[bu.state] ?? String(bu.state),
    snapshots: bu.snapshots,
    voterCount: bu.voterCount,
    merkleRoot: bu.merkleRoot,
    grandTotalVotes: bu.grandTotalVotes,
    blockTimestamp: bu.blockTimestamp,
    blockNumber: bu.blockNumber,
    generatedAtIso: new Date().toISOString(),
  }) as Omit<BoletimUrnaDocument, "sha256">;

  const json = JSON.stringify(body);
  const sha256 = createHash("sha256").update(json).digest("hex");

  return { ...(body as BoletimUrnaDocument), sha256 };
}
