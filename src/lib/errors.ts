"use strict";

/** Application-level error with HTTP status code. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** 400 Bad Request */
export const badRequest = (msg: string, code?: string) =>
  new AppError(400, msg, code);

/** 404 Not Found */
export const notFound = (msg: string) => new AppError(404, msg, "NOT_FOUND");

/** 409 Conflict */
export const conflict = (msg: string, code: string) =>
  new AppError(409, msg, code);

/** 429 Too Many Requests */
export const tooManyRequests = () =>
  new AppError(429, "Rate limit exceeded", "RATE_LIMITED");

/** 500 Internal Server Error */
export const internal = (msg: string) => new AppError(500, msg, "INTERNAL");

/** 501 Not Implemented */
export const notConfigured = (feature: string) =>
  new AppError(501, `${feature} is not configured`, "NOT_CONFIGURED");
