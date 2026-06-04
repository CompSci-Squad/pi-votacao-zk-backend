/**
 * contractErrors.ts
 *
 * Decodes ethers v6 CALL_EXCEPTION errors (on-chain reverts) into AppErrors
 * with human-readable messages and correct HTTP status codes.
 *
 * All 19 custom errors from VotingContract.sol are handled explicitly.
 * Unknown reverts fall back to 400 with the raw selector message.
 *
 * Usage:
 *   import { revertToAppError } from "../lib/contractErrors";
 *   try { await tx.wait(); } catch (err) { throw revertToAppError(err); }
 */

import { AppError, badRequest, conflict, forbidden, internal } from "./errors";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EthersRevert {
  name: string;
  args: Record<string, unknown> & unknown[];
}

interface EthersCallException {
  code: string;
  revert?: EthersRevert | null;
  reason?: string | null;
  message?: string;
}

function isCallException(err: unknown): err is EthersCallException {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as EthersCallException).code === "CALL_EXCEPTION"
  );
}

/**
 * Map a decoded revert name + args to an AppError.
 *
 * HTTP semantics:
 *   400 Bad Request   — invalid input (wrong state machine inputs, bad proof, etc.)
 *   403 Forbidden     — caller is not the admin
 *   409 Conflict      — action not allowed in current state, or duplicate resource
 */
function decodeRevert(revert: EthersRevert): AppError {
  const { name, args } = revert;

  switch (name) {
    // ── Access control ────────────────────────────────────────────────────
    case "NotAdmin":
      return forbidden(
        "Only the election admin can perform this action.",
        "NOT_ADMIN",
      );

    // ── State machine ─────────────────────────────────────────────────────
    case "ElectionNotPending":
      return conflict(
        "This action requires the election to be in PENDING state. " +
        "The election may already be open or finished.",
        "ELECTION_NOT_PENDING",
      );

    case "ElectionNotOpen":
      return conflict(
        "This action requires the election to be OPEN. " +
        "Open the election before casting votes.",
        "ELECTION_NOT_OPEN",
      );

    case "ElectionNotFinished":
      return conflict(
        "This action requires the election to be FINISHED. " +
        "Close the election first.",
        "ELECTION_NOT_FINISHED",
      );

    case "ElectionAlreadyExists":
      return conflict(
        "An election already exists at this address.",
        "ELECTION_ALREADY_EXISTS",
      );

    // ── Voter registration ────────────────────────────────────────────────
    case "VoterHashesAlreadyRegistered":
      return conflict(
        "Voter hashes are already registered for this election. " +
        "registerVoterHashes() can only be called once.",
        "VOTER_HASHES_ALREADY_REGISTERED",
      );

    case "NoVoterHashesRegistered":
      return conflict(
        "Voter hashes must be registered before setting the Merkle root. " +
        "Call POST /voters first.",
        "NO_VOTER_HASHES",
      );

    case "TooManyVoters": {
      const provided = args?.[0]?.toString() ?? "?";
      const maximum  = args?.[1]?.toString() ?? "16";
      return badRequest(
        `Too many voters: received ${provided}, maximum is ${maximum}.`,
        "TOO_MANY_VOTERS",
      );
    }

    case "InvalidVoterHash": {
      const index = args?.[0]?.toString() ?? "?";
      return badRequest(
        `Voter hash at index ${index} is zero, which is not a valid Poseidon commitment. ` +
        "All hashes must be non-zero field elements.",
        "INVALID_VOTER_HASH",
      );
    }

    // ── Candidates ────────────────────────────────────────────────────────
    case "CandidateNumberAlreadyUsed": {
      const number = args?.[0]?.toString() ?? "?";
      return conflict(
        `Candidate number ${number} is already assigned to another candidate in this race.`,
        "CANDIDATE_NUMBER_USED",
      );
    }

    case "CandidateNotFound": {
      const candidateId = args?.[0]?.toString() ?? "?";
      return badRequest(
        `Candidate with ID ${candidateId} does not exist in this election.`,
        "CANDIDATE_NOT_FOUND",
      );
    }

    // ── Races ─────────────────────────────────────────────────────────────
    case "InvalidRaceId": {
      const raceId = args?.[0]?.toString() ?? "?";
      return badRequest(
        `Race ID ${raceId} does not exist in this election.`,
        "INVALID_RACE_ID",
      );
    }

    case "InvalidMaxPicks":
      return badRequest(
        "maxPicks must be at least 1.",
        "INVALID_MAX_PICKS",
      );

    // ── ZK proof / vote ───────────────────────────────────────────────────
    case "InvalidMerkleRoot": {
      const provided = args?.[0]?.toString() ?? "?";
      const expected = args?.[1]?.toString() ?? "?";
      return badRequest(
        `Merkle root mismatch: the proof was generated with root ${provided} ` +
        `but the contract has root ${expected}. ` +
        "Re-fetch the Merkle proof and regenerate your ZK proof.",
        "INVALID_MERKLE_ROOT",
      );
    }

    case "InvalidElectionId": {
      const provided = args?.[0]?.toString() ?? "?";
      const expected = args?.[1]?.toString() ?? "?";
      return badRequest(
        `Election ID mismatch: pubSignals[3] is ${provided} ` +
        `but the contract has election ID ${expected}. ` +
        "Regenerate your ZK proof with the correct election_id.",
        "INVALID_ELECTION_ID",
      );
    }

    case "RaceIdMismatch": {
      const paramRaceId  = args?.[0]?.toString() ?? "?";
      const signalRaceId = args?.[1]?.toString() ?? "?";
      return badRequest(
        `Race ID mismatch: raceId param is ${paramRaceId} ` +
        `but pubSignals[4] contains ${signalRaceId}. ` +
        "Both must be the same value.",
        "RACE_ID_MISMATCH",
      );
    }

    case "NullifierAlreadyUsed": {
      const nullifier = args?.[0]?.toString() ?? "?";
      return conflict(
        `This vote has already been cast (nullifier ${nullifier} is already on-chain). ` +
        "Each voter may only vote once per race.",
        "NULLIFIER_USED",
      );
    }

    case "InvalidProof":
      return badRequest(
        "ZK proof verification failed. The proof is invalid or was generated " +
        "with incorrect inputs (wrong voter_id, merkle_path, election_id, race_id, or pick_index).",
        "INVALID_PROOF",
      );

    case "PickIndexOutOfRange": {
      const raceId    = args?.[0]?.toString() ?? "?";
      const pickIndex = args?.[1]?.toString() ?? "?";
      const maxPicks  = args?.[2]?.toString() ?? "?";
      return badRequest(
        `Pick index ${pickIndex} is out of range for race ${raceId} ` +
        `(maxPicks = ${maxPicks}). pick_index must be 0..${Number(maxPicks) - 1}.`,
        "PICK_OUT_OF_RANGE",
      );
    }

    // ── Unknown custom error ───────────────────────────────────────────────
    default:
      return badRequest(
        `Contract reverted with error: ${name}` +
        (args?.length ? ` (args: ${JSON.stringify(args)})` : ""),
        "CONTRACT_REVERT",
      );
  }
}

/**
 * Convert any error thrown by an ethers v6 contract call / tx.wait() into
 * an AppError with a descriptive message and a correct HTTP status code.
 *
 * If the error is not a CALL_EXCEPTION it is re-thrown as-is so the global
 * Fastify error handler can deal with it as a 500.
 */
export function revertToAppError(err: unknown): AppError {
  if (!isCallException(err)) {
    // Not a contract revert — let it bubble as an unexpected error.
    return internal((err as Error)?.message ?? "Unexpected blockchain error");
  }

  // ethers v6 decoded a known custom error
  if (err.revert) {
    return decodeRevert(err.revert);
  }

  // require/revert with a plain string reason
  if (err.reason) {
    return badRequest(`Transaction reverted: ${err.reason}`, "CONTRACT_REVERT");
  }

  // Reverted with no reason (e.g. assert failure, or ABI mismatch)
  return badRequest(
    "Transaction reverted with no reason. This may be an assert() failure " +
    "or a call to a non-existent contract function.",
    "CONTRACT_REVERT",
  );
}
