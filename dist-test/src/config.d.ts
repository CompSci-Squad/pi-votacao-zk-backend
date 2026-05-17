import "dotenv/config";
export declare const config: {
    readonly port: number;
    readonly logLevel: string;
    readonly corsOrigin: string;
    readonly rpcUrl: string;
    readonly factoryAddress: string;
    /** Throws if RELAYER_PRIVATE_KEY is not set. Safe to call at server start. */
    readonly relayerPrivateKey: string;
    readonly rateLimitCount: number;
    readonly rateWindowMs: number;
    readonly pendingLogDir: string;
    readonly epochWindowMs: number;
    readonly auditAnchorEnabled: boolean;
};
export type Config = typeof config;
//# sourceMappingURL=config.d.ts.map