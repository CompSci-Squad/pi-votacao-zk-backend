"use strict";

/**
 * voters.ts  —  CRUD routes for voter management and Merkle inclusion proofs.
 *
 * Mounted at prefix /elections (and /events for compat) in server.ts.
 *
 * Routes (relative to prefix):
 *   GET  /:addr/voters               → list enrolled voter commitments
 *   POST /:addr/voters               → register hashes + set Merkle root
 *   GET  /:addr/voters/:commitment   → Merkle inclusion proof for a commitment
 *
 * Voter commitments are Poseidon(voter_id) — derived by the voter's browser
 * from (cpf, pin, eventAddr) without sending sensitive values to the backend.
 *
 * The POST endpoint calls registerVoterHashes then setMerkleRoot sequentially
 * (the contract enforces that order).  Both or neither change will be applied
 * in a single setup step.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readVoterCommitments } from "../chain/event";
import { registerVoterHashes, setMerkleRoot } from "../chain/admin";
import { getProvider } from "../chain/provider";
import { getCachedTree } from "../tree/cache";
import { toSafeJson } from "../lib/serialize";
import { badRequest } from "../lib/errors";
import { validateAddr } from "../lib/validateAddr";
import { requireAdminKey } from "../lib/adminAuth";

// ── Schema ────────────────────────────────────────────────────────────────────

const decimalStr = z
  .string()
  .regex(/^\d+$/, "Must be a non-negative decimal integer string");

const registerVotersSchema = z.object({
  /**
   * Voter commitments: Poseidon(voter_id) for each registered voter.
   * Decimal string format (bigint).  Max 16 entries (Merkle depth 4).
   */
  hashes: z
    .array(decimalStr)
    .min(1, "At least one hash is required")
    .max(16, "Maximum 16 voters (Merkle tree depth 4)"),
  /**
   * Poseidon Merkle root of the voter set.
   * Must match the root computed from the same hashes used by the ZK circuit.
   */
  merkleRoot: decimalStr,
});

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function votersRoutes(fastify: FastifyInstance) {
  // ── GET /:addr/voters ──────────────────────────────────────────────────────
  fastify.get<{ Params: { addr: string } }>(
    "/:addr/voters",
    async (req, reply) => {
      validateAddr(req.params.addr);
      const commitments = await readVoterCommitments(req.params.addr);
      reply.send(toSafeJson(commitments));
    },
  );

  // ── POST /:addr/voters ─────────────────────────────────────────────────────
  fastify.post<{ Params: { addr: string } }>(
    "/:addr/voters",
    { preHandler: [requireAdminKey] },
    async (req, reply) => {
      const { addr } = req.params;
      validateAddr(addr);
      const parse = registerVotersSchema.safeParse(req.body);
      if (!parse.success) {
        throw badRequest(
          parse.error.issues.map((i) => i.message).join(", "),
          "INVALID_BODY",
        );
      }

      const hashes = parse.data.hashes.map((h) => BigInt(h));
      const root = BigInt(parse.data.merkleRoot);

      // Sequential: contract requires hashes before root
      const hashReceipt = await registerVoterHashes(addr, hashes);
      const rootReceipt = await setMerkleRoot(addr, root);

      reply.status(201).send(
        toSafeJson({ hashes: hashReceipt, merkleRoot: rootReceipt }),
      );
    },
  );

  // ── GET /:addr/voters/:commitment ──────────────────────────────────────────
  fastify.get<{ Params: { addr: string; commitment: string } }>(
    "/:addr/voters/:commitment",
    async (req, reply) => {
      const { addr, commitment } = req.params;
      validateAddr(addr);
      const blockNumber = await getProvider().getBlockNumber();
      const tree = await getCachedTree(addr, blockNumber);

      const leafIndex = tree.indexOf(commitment);
      if (leafIndex === -1) {
        reply.send({
          included: false,
          leafIndex: -1,
          pathElements: [],
          pathIndices: [],
          root: tree.root,
        });
        return;
      }

      const { pathElements, pathIndices, root } =
        tree.inclusionProof(leafIndex);

      reply.send({
        included: true,
        leafIndex,
        pathElements,
        pathIndices,
        root,
      });
    },
  );
}
