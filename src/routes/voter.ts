"use strict";

import type { FastifyInstance } from "fastify";
import { getProvider } from "../chain/provider";
import { getCachedTree } from "../tree/cache";
import { notFound } from "../lib/errors";

export default async function voterRoutes(fastify: FastifyInstance) {
  /**
   * GET /events/:addr/voters/:commitment
   *
   * Returns the Merkle inclusion proof for a voter commitment.
   * The voter's browser uses this to build the ZK proof circuit input:
   *   { merkle_path, merkle_path_indices, merkle_root }
   *
   * The commitment is Poseidon(voter_id) — derived in the browser from
   * (cpf, pin, eventAddr) without ever sending those values to the backend.
   *
   * Response shape (all bigints as decimal strings):
   *   {
   *     included:     bool,
   *     leafIndex:    number,
   *     pathElements: string[4],   // sibling hashes
   *     pathIndices:  number[4],   // 0 or 1
   *     root:         string,
   *   }
   */
  fastify.get<{ Params: { addr: string; commitment: string } }>(
    "/events/:addr/voters/:commitment",
    async (req, reply) => {
      const { addr, commitment } = req.params;

      const blockNumber = await getProvider().getBlockNumber();
      const tree = await getCachedTree(addr, blockNumber);

      const leafIndex = tree.indexOf(commitment);
      if (leafIndex === -1) {
        reply.send({ included: false, leafIndex: -1, pathElements: [], pathIndices: [], root: tree.root });
        return;
      }

      const { pathElements, pathIndices, root } = tree.inclusionProof(leafIndex);

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
