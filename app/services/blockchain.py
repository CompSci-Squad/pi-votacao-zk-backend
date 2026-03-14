"""Web3.py wrapper — manages connection, account and transaction signing."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from web3 import Web3
from web3.contract import Contract
from web3.middleware import ExtraDataToPOAMiddleware

from app.config import settings


ABI_PATH = Path(__file__).parent.parent / "abi" / "VotingContract.json"


def _load_abi() -> list[dict]:
    with open(ABI_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


class BlockchainService:
    """Singleton-style service that holds the Web3 connection and contract."""

    def __init__(self) -> None:
        self.w3 = Web3(Web3.HTTPProvider(settings.rpc_url))
        # Inject PoA middleware (needed for Sepolia / Clique-based networks)
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

        if settings.admin_private_key:
            self.account = self.w3.eth.account.from_key(settings.admin_private_key)
        else:
            self.account = None

        abi = _load_abi()
        self.contract: Contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(settings.contract_address) if settings.contract_address else None,
            abi=abi,
        )

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    def call(self, function_name: str, *args: Any) -> Any:
        """Call a read-only (view/pure) contract function."""
        fn = getattr(self.contract.functions, function_name)
        return fn(*args).call()

    # ------------------------------------------------------------------
    # Write helpers
    # ------------------------------------------------------------------

    def send(self, function_name: str, *args: Any) -> str:
        """Build, sign and send a state-changing contract transaction.

        Returns the transaction hash as a hex string.
        """
        if self.account is None:
            raise RuntimeError("ADMIN_PRIVATE_KEY is not configured")

        fn = getattr(self.contract.functions, function_name)
        nonce = self.w3.eth.get_transaction_count(self.account.address)
        built_tx = fn(*args).build_transaction(
            {
                "from": self.account.address,
                "nonce": nonce,
            }
        )
        signed = self.account.sign_transaction(built_tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return tx_hash.hex()


# Module-level singleton — imported by contract service
blockchain_service = BlockchainService()
