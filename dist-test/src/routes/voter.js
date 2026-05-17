"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = voterRoutes;
const provider_1 = require("../chain/provider");
const cache_1 = require("../tree/cache");
async function voterRoutes(fastify) {
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
    fastify.get("/events/:addr/voters/:commitment", async (req, reply) => {
        const { addr, commitment } = req.params;
        const blockNumber = await (0, provider_1.getProvider)().getBlockNumber();
        const tree = await (0, cache_1.getCachedTree)(addr, blockNumber);
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
    });
}
//# sourceMappingURL=voter.js.map