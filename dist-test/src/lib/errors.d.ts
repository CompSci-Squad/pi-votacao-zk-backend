/** Application-level error with HTTP status code. */
export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code?: string | undefined;
    constructor(statusCode: number, message: string, code?: string | undefined);
}
/** 400 Bad Request */
export declare const badRequest: (msg: string, code?: string) => AppError;
/** 404 Not Found */
export declare const notFound: (msg: string) => AppError;
/** 409 Conflict */
export declare const conflict: (msg: string, code: string) => AppError;
/** 429 Too Many Requests */
export declare const tooManyRequests: () => AppError;
/** 500 Internal Server Error */
export declare const internal: (msg: string) => AppError;
/** 501 Not Implemented */
export declare const notConfigured: (feature: string) => AppError;
//# sourceMappingURL=errors.d.ts.map