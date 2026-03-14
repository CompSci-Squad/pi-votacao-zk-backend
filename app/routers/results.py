"""Results query endpoint."""

from fastapi import APIRouter, HTTPException

from app.schemas.models import ElectionResults
from app.services import contract as svc

router = APIRouter(prefix="/api/elections", tags=["results"])


@router.get("/{election_id}/results", response_model=ElectionResults)
def get_results(election_id: int):
    """Return election results read from the blockchain."""
    try:
        data = svc.get_results(election_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return data
