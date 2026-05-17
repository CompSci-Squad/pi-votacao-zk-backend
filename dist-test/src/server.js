"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServer = buildServer;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const config_1 = require("./config");
const errors_1 = require("./lib/errors");
const pendingLog_1 = require("./audit/pendingLog");
const public_1 = __importDefault(require("./routes/public"));
const voter_1 = __importDefault(require("./routes/voter"));
const relay_1 = __importDefault(require("./routes/relay"));
const admin_1 = __importDefault(require("./routes/admin"));
async function buildServer() {
    const fastify = (0, fastify_1.default)({
        logger: {
            level: config_1.config.logLevel,
        },
    });
    // ── CORS ──────────────────────────────────────────────────────────────────
    await fastify.register(cors_1.default, {
        origin: config_1.config.corsOrigin === "*" ? true : config_1.config.corsOrigin,
        methods: ["GET", "POST", "OPTIONS"],
    });
    // ── Routes ────────────────────────────────────────────────────────────────
    await fastify.register(public_1.default);
    await fastify.register(voter_1.default);
    await fastify.register(relay_1.default);
    await fastify.register(admin_1.default);
    // ── Global error handler ──────────────────────────────────────────────────
    fastify.setErrorHandler((err, _req, reply) => {
        if (err instanceof errors_1.AppError) {
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
        (0, pendingLog_1.startPendingLog)();
        // Graceful shutdown
        const shutdown = async (signal) => {
            server.log.info({ signal }, "Shutting down");
            await (0, pendingLog_1.stopPendingLog)();
            await server.close();
            process.exit(0);
        };
        process.once("SIGINT", () => shutdown("SIGINT"));
        process.once("SIGTERM", () => shutdown("SIGTERM"));
        try {
            await server.listen({ port: config_1.config.port, host: "0.0.0.0" });
        }
        catch (err) {
            server.log.error(err);
            process.exit(1);
        }
    })();
}
//# sourceMappingURL=server.js.map