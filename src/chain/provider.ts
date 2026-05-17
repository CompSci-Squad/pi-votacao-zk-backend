"use strict";

import { ethers } from "ethers";
import { config } from "../config";

let _provider: ethers.JsonRpcProvider | null = null;

/**
 * Return a shared JsonRpcProvider.
 *
 * batchMaxCount: 1 prevents the ethers v6 default batching behaviour where two
 * sequential awaits (e.g. two deploys in the same tick) can share a single
 * eth_getTransactionCount request and produce duplicate nonces. This matches
 * the fix applied in the blockchain repo's integration suite (SESSION_LOG
 * 2026-04-25).
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, {
      batchMaxCount: 1,
    });
  }
  return _provider;
}

/** Replace the provider (test helper — lets integration tests inject a local provider). */
export function setProvider(p: ethers.JsonRpcProvider): void {
  _provider = p;
}

/** Reset the singleton (test helper). */
export function _resetProviderForTests(): void {
  _provider = null;
}
