import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config";
import { unauthorized, notConfigured } from "./errors";

/**
 * Fastify preHandler — enforce X-Admin-Key authentication on admin write routes.
 *
 * Throws an AppError so the global error handler formats the response
 * consistently with all other API errors.
 *
 * Configuration: set ADMIN_KEY in .env.
 * Security: must be used over HTTPS only — this is a shared-secret API key.
 */
export async function requireAdminKey(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!config.adminKey) {
    throw notConfigured("ADMIN_KEY");
  }

  const provided = req.headers["x-admin-key"] as string | undefined;
  if (!provided || provided !== config.adminKey) {
    throw unauthorized("Missing or incorrect X-Admin-Key header");
  }
}
