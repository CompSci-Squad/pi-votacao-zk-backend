#!/bin/sh
# docker-entrypoint.sh
#
# Loads FACTORY_ADDRESS (and VERIFIER_ADDRESS) from /shared/addresses.env
# written by the deployer container, then starts the Fastify server.
#
# The docker-compose.yml already injects a deterministic fallback value for
# FACTORY_ADDRESS, so the server starts even if the shared file is missing.
# The file takes precedence when present.

set -e

SHARED_ENV="/shared/addresses.env"

if [ -f "${SHARED_ENV}" ]; then
  echo "[entrypoint] Loading deployed addresses from ${SHARED_ENV}"
  # Export only the two known-safe address variables; ignore any other lines.
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    case "${key}" in
      \#* | "") continue ;;
    esac
    case "${key}" in
      FACTORY_ADDRESS | VERIFIER_ADDRESS)
        export "${key}=${value}"
        echo "[entrypoint] ${key}=${value}"
        ;;
    esac
  done < "${SHARED_ENV}"
else
  echo "[entrypoint] ${SHARED_ENV} not found — using FACTORY_ADDRESS from environment"
  echo "[entrypoint] FACTORY_ADDRESS=${FACTORY_ADDRESS:-<not set>}"
fi

exec node dist/server.js
