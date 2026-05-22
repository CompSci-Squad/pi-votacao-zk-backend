"use strict";

import { isAddress } from "ethers";
import { badRequest } from "./errors";

/**
 * Assert that `addr` is a valid Ethereum address (0x + 20 bytes, any case).
 * Throws a 400 AppError so Fastify propagates it as a structured response.
 *
 * Call at the top of any route handler that accepts an :addr param before
 * passing the value to the chain layer.
 */
export function validateAddr(addr: string): void {
  if (!isAddress(addr)) {
    throw badRequest(
      `"${addr}" is not a valid Ethereum address`,
      "INVALID_ADDRESS",
    );
  }
}
