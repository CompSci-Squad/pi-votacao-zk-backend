"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProvider = getProvider;
exports.setProvider = setProvider;
exports._resetProviderForTests = _resetProviderForTests;
const ethers_1 = require("ethers");
const config_1 = require("../config");
let _provider = null;
/**
 * Return a shared JsonRpcProvider.
 *
 * batchMaxCount: 1 prevents the ethers v6 default batching behaviour where two
 * sequential awaits (e.g. two deploys in the same tick) can share a single
 * eth_getTransactionCount request and produce duplicate nonces. This matches
 * the fix applied in the blockchain repo's integration suite (SESSION_LOG
 * 2026-04-25).
 */
function getProvider() {
    if (!_provider) {
        _provider = new ethers_1.ethers.JsonRpcProvider(config_1.config.rpcUrl, undefined, {
            batchMaxCount: 1,
        });
    }
    return _provider;
}
/** Replace the provider (test helper — lets integration tests inject a local provider). */
function setProvider(p) {
    _provider = p;
}
/** Reset the singleton (test helper). */
function _resetProviderForTests() {
    _provider = null;
}
//# sourceMappingURL=provider.js.map