/**
 * Recursively convert BigInt values to decimal strings so the result is safe
 * to pass to Fastify's reply.send() (which uses JSON.stringify internally).
 *
 * Handles: primitive bigint, arrays, plain objects, null, undefined.
 * Leaves all other types (string, number, boolean) untouched.
 */
export declare function toSafeJson(val: unknown): unknown;
//# sourceMappingURL=serialize.d.ts.map