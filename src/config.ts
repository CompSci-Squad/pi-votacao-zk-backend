"use strict";

import "dotenv/config";

function required(name: string): string {
  const val = process.env[name];
  if (!val || val === "0x...") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),
  logLevel: optional("LOG_LEVEL", "info"),
  corsOrigin: optional("CORS_ORIGIN", "*"),

  /** Reads process.env lazily so tests can inject RPC_URL before each run. */
  get rpcUrl(): string {
    return optional("RPC_URL", "http://127.0.0.1:8545");
  },

  /** Reads process.env lazily so tests can inject FACTORY_ADDRESS before each run. */
  get factoryAddress(): string {
    return optional("FACTORY_ADDRESS", "");
  },

  /** Throws if RELAYER_PRIVATE_KEY is not set. Safe to call at server start. */
  get relayerPrivateKey(): string {
    return required("RELAYER_PRIVATE_KEY");
  },

  rateLimitCount: parseInt(optional("RATE_LIMIT_COUNT", "10"), 10),
  rateWindowMs: parseInt(optional("RATE_WINDOW_MS", "60000"), 10),

  pendingLogDir: optional("PENDING_LOG_DIR", "./pending-logs"),
  epochWindowMs: parseInt(optional("EPOCH_WINDOW_MS", "300000"), 10),
  auditAnchorEnabled: optional("AUDIT_ANCHOR_ENABLED", "false") === "true",
} as const;

export type Config = typeof config;
