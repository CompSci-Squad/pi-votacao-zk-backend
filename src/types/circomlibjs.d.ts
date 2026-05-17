/**
 * Minimal type declarations for circomlibjs (no official @types package).
 * Only the subset used by this project is typed.
 */
declare module "circomlibjs" {
  export interface FieldArithmetic {
    zero: Uint8Array;
    one: Uint8Array;
    toString(x: Uint8Array): string;
    e(x: bigint | string | number): Uint8Array;
    eq(a: Uint8Array, b: Uint8Array): boolean;
  }

  export interface PoseidonFn {
    (inputs: (bigint | string | number | Uint8Array)[]): Uint8Array;
    F: FieldArithmetic;
  }

  export function buildPoseidon(): Promise<PoseidonFn>;
}
