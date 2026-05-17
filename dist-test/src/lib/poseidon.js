"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPoseidon = getPoseidon;
exports.fieldToStr = fieldToStr;
exports._resetPoseidonForTests = _resetPoseidonForTests;
const circomlibjs_1 = require("circomlibjs");
let _poseidon = null;
let _initPromise = null;
/**
 * Return the shared Poseidon function, initialising it on first call.
 * Subsequent calls return the cached instance immediately.
 */
async function getPoseidon() {
    if (_poseidon)
        return _poseidon;
    if (_initPromise)
        return _initPromise;
    _initPromise = (0, circomlibjs_1.buildPoseidon)().then((p) => {
        _poseidon = p;
        return p;
    });
    return _initPromise;
}
/** Convert a field element (Uint8Array from circomlibjs) to decimal string. */
function fieldToStr(poseidon, x) {
    return poseidon.F.toString(x);
}
/** Reset the singleton (test helper only). */
function _resetPoseidonForTests() {
    _poseidon = null;
    _initPromise = null;
}
//# sourceMappingURL=poseidon.js.map