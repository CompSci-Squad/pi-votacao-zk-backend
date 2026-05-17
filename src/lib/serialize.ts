"use strict";

/**
 * Recursively convert BigInt values to decimal strings so the result is safe
 * to pass to Fastify's reply.send() (which uses JSON.stringify internally).
 *
 * Handles: primitive bigint, arrays, plain objects, null, undefined.
 * Leaves all other types (string, number, boolean) untouched.
 */
export function toSafeJson(val: unknown): unknown {
  if (typeof val === "bigint") return val.toString();
  if (Array.isArray(val)) return val.map(toSafeJson);
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = toSafeJson(v);
    }
    return out;
  }
  return val;
}
