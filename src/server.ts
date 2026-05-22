"use strict";

import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
import { AppError } from "./lib/errors";
import { startPendingLog, stopPendingLog } from "./audit/pendingLog";

// ── Legacy routes (/events prefix, kept for backwards compatibility) ──────────
import publicRoutes from "./routes/public";
import voterRoutes from "./routes/voter";
import relayRoutes from "./routes/relay";
import adminRoutes from "./routes/admin";

// ── New CRUD routes (/elections prefix) ───────────────────────────────────────
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

  // ── CORS ──────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: config.corsOrigin === "*" ? true : config.corsOrigin,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  // ── CRUD API  /elections/* ────────────────────────────────────────────────
  await fastify.register(electionsRoutes, { prefix: "/elections" });
  await fastify.register(racesRoutes,     { prefix: "/elections" });
  await fastify.register(candidatesRoutes,{ prefix: "/elections" });
  await fastify.register(votersRoutes,    { prefix: "/elections" });
  await fastify.register(votesRoutes,     { prefix: "/elections" });
  await fastify.register(auditRoutes,     { prefix: "/elections" });

  // ── Legacy routes  /events/* (backwards compat) ───────────────────────────
  await fastify.register(publicRoutes);
  await fastify.register(voterRoutes);
  await fastify.register(relayRoutes);
  await fastify.register(adminRoutes);

  // ── Global error handler ──────────────────────────────────────────────────
  fastify.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        error: err.message,
        code: err.code ?? "ERROR",
      });
      return;
    }

    // Zod parse errors bubble up as regular Errors — already handled in routes
    // Unknown errors: log and return 500
    fastify.log.error({ err }, "Unhandled error");
    reply.status(500).send({ error: "Internal server error", code: "INTERNAL" });
  });

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
