"use strict";

import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
import { AppError } from "./lib/errors";
import { startPendingLog, stopPendingLog } from "./audit/pendingLog";

// ── CRUD routes (/elections prefix) ───────────────────────────────────────────
import electionsRoutes from "./routes/elections";
import racesRoutes from "./routes/races";
import candidatesRoutes from "./routes/candidates";
import votersRoutes from "./routes/voters";
import votesRoutes from "./routes/votes";
import auditRoutes from "./routes/audit";

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  // ── Global error handler ──────────────────────────────────────────────────
  // MUST be set before registering plugins. Fastify child scopes snapshot the
  // parent error handler at plugin-load time (triggered by await register()).
  // Setting it after register() means plugins load with the default handler.
  fastify.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.statusCode).type("application/json").send({
        error: err.message,
        code: err.code,
      });
      return;
    }
    fastify.log.error({ err }, "Unhandled error");
    reply.code(500).type("application/json").send({
      error: "Internal server error",
      code: "INTERNAL",
    });
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: config.corsOrigin === "*" ? true : config.corsOrigin,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  // ── Health check ──────────────────────────────────────────────────────────
  fastify.get("/health", async (_req, reply) => {
    reply.send({ ok: true, ts: Date.now() });
  });

  // ── CRUD API  /elections/* ────────────────────────────────────────────────
  await fastify.register(electionsRoutes, { prefix: "/elections" });
  await fastify.register(racesRoutes,     { prefix: "/elections" });
  await fastify.register(candidatesRoutes,{ prefix: "/elections" });
  await fastify.register(votersRoutes,    { prefix: "/elections" });
  await fastify.register(votesRoutes,     { prefix: "/elections" });
  await fastify.register(auditRoutes,     { prefix: "/elections" });

  return fastify;
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    const server = await buildServer();

    // Start the pending-proofs log epoch rotation
    startPendingLog();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      server.log.info({ signal }, "Shutting down");
      await stopPendingLog();
      await server.close();
      process.exit(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

    try {
      await server.listen({ port: config.port, host: "0.0.0.0" });
    } catch (err) {
      server.log.error(err);
      process.exit(1);
    }
  })();
}
