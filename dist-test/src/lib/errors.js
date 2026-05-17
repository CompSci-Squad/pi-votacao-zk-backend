"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notConfigured = exports.internal = exports.tooManyRequests = exports.conflict = exports.notFound = exports.badRequest = exports.AppError = void 0;
/** Application-level error with HTTP status code. */
class AppError extends Error {
    statusCode;
    code;
    constructor(statusCode, message, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = "AppError";
    }
}
exports.AppError = AppError;
/** 400 Bad Request */
const badRequest = (msg, code) => new AppError(400, msg, code);
exports.badRequest = badRequest;
/** 404 Not Found */
const notFound = (msg) => new AppError(404, msg, "NOT_FOUND");
exports.notFound = notFound;
/** 409 Conflict */
const conflict = (msg, code) => new AppError(409, msg, code);
exports.conflict = conflict;
/** 429 Too Many Requests */
const tooManyRequests = () => new AppError(429, "Rate limit exceeded", "RATE_LIMITED");
exports.tooManyRequests = tooManyRequests;
/** 500 Internal Server Error */
const internal = (msg) => new AppError(500, msg, "INTERNAL");
exports.internal = internal;
/** 501 Not Implemented */
const notConfigured = (feature) => new AppError(501, `${feature} is not configured`, "NOT_CONFIGURED");
exports.notConfigured = notConfigured;
//# sourceMappingURL=errors.js.map