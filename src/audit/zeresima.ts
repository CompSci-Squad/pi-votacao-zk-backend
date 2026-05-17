"use strict";

import { createHash } from "crypto";
import { getVotingContract } from "../chain/event";
import { toSafeJson } from "../lib/serialize";
import { ElectionState } from "../chain/event";
import { AppError } from "../lib/errors";

export interface ZeresimaDocument {
  type: "ZERESIMA";
  eventAddr: string;
  electionName: string;
  electionId: string;
  state: string;
  snapshots: unknown[];
  voterCount: string;
  merkleRoot: string;
  allZero: boolean;
  blockTimestamp: string;
  blockNumber: string;
  generatedAtIso: string;
  sha256: string;
}

/**
 * Fetch the multi-race Zerésima from the VotingContract.
 * Only available while the election is in PENDING state.
 * Returns a self-describing JSON document with a sha256 digest.
 */
export async function buildZeresima(
  eventAddr: string,
): Promise<ZeresimaDocument> {
  const c = getVotingContract(eventAddr);

  let raw: Awaited<ReturnType<typeof c.getZeresimaMultiRace>>;
  try {
    raw = await c.getZeresimaMultiRace();
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    if (msg.includes("ElectionNotPending") || msg.includes("not pending")) {
      throw new AppError(
        409,
        "Zerésima is only available while the election is PENDING",
        "NOT_PENDING",
      );
    }
    throw err;
  }

  const body = toSafeJson({
    type: "ZERESIMA",
    eventAddr,
    electionName: raw.electionName,
    electionId: raw.electionId,
    state: ElectionState[ElectionState.PENDING],
    snapshots: raw.snapshots,
    voterCount: raw.voterCount,
    merkleRoot: raw.merkleRoot,
    allZero: raw.allZero,
    blockTimestamp: raw.blockTimestamp,
    blockNumber: raw.blockNumber,
    generatedAtIso: new Date().toISOString(),
  }) as Omit<ZeresimaDocument, "sha256">;

  const json = JSON.stringify(body);
  const sha256 = createHash("sha256").update(json).digest("hex");

  return { ...(body as ZeresimaDocument), sha256 };
}
