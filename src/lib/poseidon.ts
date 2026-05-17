"use strict";

import { buildPoseidon, PoseidonFn } from "circomlibjs";

let _poseidon: PoseidonFn | null = null;
let _initPromise: Promise<PoseidonFn> | null = null;

/**
 * Return the shared Poseidon function, initialising it on first call.
 * Subsequent calls return the cached instance immediately.
 */
export async function getPoseidon(): Promise<PoseidonFn> {
  if (_poseidon) return _poseidon;
  if (_initPromise) return _initPromise;

  _initPromise = buildPoseidon().then((p) => {
    _poseidon = p;
    return p;
  });
  return _initPromise;
}

/** Convert a field element (Uint8Array from circomlibjs) to decimal string. */
export function fieldToStr(poseidon: PoseidonFn, x: Uint8Array): string {
  return poseidon.F.toString(x);
}

/** Reset the singleton (test helper only). */
export function _resetPoseidonForTests(): void {
  _poseidon = null;
  _initPromise = null;
}
