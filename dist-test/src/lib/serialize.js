"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSafeJson = toSafeJson;
/**
 * Recursively convert BigInt values to decimal strings so the result is safe
 * to pass to Fastify's reply.send() (which uses JSON.stringify internally).
 *
 * Handles: primitive bigint, arrays, plain objects, null, undefined.
 * Leaves all other types (string, number, boolean) untouched.
 */
function toSafeJson(val) {
    if (typeof val === "bigint")
        return val.toString();
    if (Array.isArray(val))
        return val.map(toSafeJson);
    if (val !== null && typeof val === "object") {
        const out = {};
        for (const [k, v] of Object.entries(val)) {
            out[k] = toSafeJson(v);
        }
        return out;
    }
    return val;
}
//# sourceMappingURL=serialize.js.map