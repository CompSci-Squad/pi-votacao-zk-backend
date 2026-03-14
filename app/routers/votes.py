"""Vote submission endpoint."""

from fastapi import APIRouter, HTTPException, status

from app.schemas.models import TransactionResponse, VoteSubmit
from app.services import contract as svc

router = APIRouter(prefix="/api/elections", tags=["votes"])


@router.post("/{election_id}/vote", response_model=TransactionResponse, status_code=status.HTTP_202_ACCEPTED)
def cast_vote(election_id: int, body: VoteSubmit):
    """Receive a ZK-SNARK proof and public signals and forward the vote to the contract."""
    try:
        tx_hash = svc.cast_vote(election_id, body.proof, body.public_signals)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TransactionResponse(tx_hash=tx_hash)
