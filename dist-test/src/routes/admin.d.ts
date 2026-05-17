/**
 * Admin GET helpers.
 *
 * These endpoints prepare information for a client-side admin UI.
 * The backend never holds an admin key — all state-changing admin
 * transactions are signed directly by the admin's wallet (MetaMask, etc.).
 *
 * Provided helpers:
 *   GET /events/:addr/admin/state        — full event state + races
 *   GET /events/:addr/admin/voters       — voter hash list (public, auditable)
 */
import type { FastifyInstance } from "fastify";
export default function adminRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=admin.d.ts.map