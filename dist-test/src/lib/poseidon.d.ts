import { PoseidonFn } from "circomlibjs";
/**
 * Return the shared Poseidon function, initialising it on first call.
 * Subsequent calls return the cached instance immediately.
 */
export declare function getPoseidon(): Promise<PoseidonFn>;
/** Convert a field element (Uint8Array from circomlibjs) to decimal string. */
export declare function fieldToStr(poseidon: PoseidonFn, x: Uint8Array): string;
/** Reset the singleton (test helper only). */
export declare function _resetPoseidonForTests(): void;
//# sourceMappingURL=poseidon.d.ts.map