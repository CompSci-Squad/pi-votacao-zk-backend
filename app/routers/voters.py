"""Voter registration endpoints."""

from fastapi import APIRouter, HTTPException, status

from app.schemas.models import (
    MerkleRootUpdate,
    TransactionResponse,
    VoterHashesRegister,
    VoterHashesResponse,
)
from app.services import contract as svc

router = APIRouter(prefix="/api/elections", tags=["voters"])


@router.post(
    "/{election_id}/voters",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_voter_hashes(election_id: int, body: VoterHashesRegister):
    """Receive an array of Poseidon hashes and register them on the blockchain."""
    try:
        tx_hash = svc.register_voter_hashes(election_id, body.hashes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TransactionResponse(tx_hash=tx_hash)


@router.post("/{election_id}/voters/merkle-root", response_model=TransactionResponse)
def set_merkle_root(election_id: int, body: MerkleRootUpdate):
    """Receive the Merkle root and store it in the contract."""
    try:
        tx_hash = svc.set_merkle_root(election_id, body.merkle_root)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TransactionResponse(tx_hash=tx_hash)


@router.get("/{election_id}/voters/hashes", response_model=VoterHashesResponse)
def get_voter_hashes(election_id: int):
    """Return voter hashes from the contract so the frontend can generate ZK proofs."""
    try:
        hashes = svc.get_voter_hashes(election_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return VoterHashesResponse(hashes=list(hashes))
