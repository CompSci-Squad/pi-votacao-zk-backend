/** Application-level error with HTTP status code and machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = "ERROR",
  ) {
    super(message);
    this.name = "AppError";
    // Ensures `instanceof AppError` works correctly after TypeScript compilation
    // to CommonJS, where the prototype chain can be broken by `class` transpilation.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** 400 Bad Request */
export const badRequest = (msg: string, code = "BAD_REQUEST") =>
  new AppError(400, msg, code);

/** 401 Unauthorized */
export const unauthorized = (msg: string, code = "UNAUTHORIZED") =>
  new AppError(401, msg, code);

/** 403 Forbidden */
export const forbidden = (msg: string, code = "FORBIDDEN") =>
  new AppError(403, msg, code);

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

/** 503 Service Unavailable — required env var not configured */
export const notConfigured = (feature: string) =>
  new AppError(503, `${feature} is not configured`, "NOT_CONFIGURED");
