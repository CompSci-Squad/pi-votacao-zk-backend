"use strict";

import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config";

/**
 * Fastify preHandler — enforce X-Admin-Key authentication on admin write routes.
 *
 * Usage (per-route):
 *   fastify.post("/", { preHandler: [requireAdminKey] }, handler)
 *
 * Configuration:
 *   Set ADMIN_KEY in .env.  If the env var is absent the endpoint returns 503
 *   so it is obvious that the service was not properly configured — not silently
 *   open.
 *
 * Security note:
 *   This is a simple shared-secret API key, suitable for a backend relay that
 *   is not directly exposed to end-users.  It must be sent over HTTPS only.
 */
export async function requireAdminKey(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = config.adminKey;

  if (!key) {
    // Env var not configured — refuse all admin operations rather than
    // silently allowing them.
    reply.status(503).send({
      error: "Admin key is not configured on this server",
      code: "ADMIN_KEY_NOT_CONFIGURED",
    });
    return;
  }

  const provided = req.headers["x-admin-key"] as string | undefined;
  if (!provided || provided !== key) {
    reply.status(401).send({
      error: "Unauthorized: missing or incorrect X-Admin-Key header",
      code: "UNAUTHORIZED",
    });
    // no return needed — Fastify stops the lifecycle after reply.send() in a preHandler
  }
}
