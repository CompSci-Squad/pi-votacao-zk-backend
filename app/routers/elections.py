"""Election CRUD endpoints."""

from fastapi import APIRouter, HTTPException, status

from app.schemas.models import (
    CandidateCreate,
    CandidateResponse,
    ElectionCreate,
    ElectionResponse,
    TransactionResponse,
)
from app.services import contract as svc

router = APIRouter(prefix="/api/elections", tags=["elections"])


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_election(body: ElectionCreate):
    """Create a new election on the blockchain."""
    try:
        tx_hash = svc.create_election(
            body.name, body.description, body.start_time, body.end_time
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TransactionResponse(tx_hash=tx_hash)


@router.get("/{election_id}", response_model=ElectionResponse)
def get_election(election_id: int):
    """Return election data read from the blockchain."""
    try:
        data = svc.get_election(election_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return data


@router.post(
    "/{election_id}/candidates",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_candidate(election_id: int, body: CandidateCreate):
    """Add a candidate to an election on the blockchain."""
    try:
        tx_hash = svc.add_candidate(election_id, body.name, body.description)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TransactionResponse(tx_hash=tx_hash)


@router.get("/{election_id}/candidates", response_model=list[CandidateResponse])
def list_candidates(election_id: int):
    """List all candidates for an election."""
    try:
        candidates = svc.get_candidates(election_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return candidates


@router.get("/{election_id}/candidates/{number}", response_model=CandidateResponse)
def get_candidate(election_id: int, number: int):
    """Preview a candidate by number (for numeric keypad UI)."""
    try:
        candidate = svc.get_candidate(election_id, number)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return candidate


@router.post("/{election_id}/open", response_model=TransactionResponse)
def open_election(election_id: int):
    """Open an election for voting."""
    try:
        tx_hash = svc.open_election(election_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TransactionResponse(tx_hash=tx_hash)


@router.post("/{election_id}/close", response_model=TransactionResponse)
def close_election(election_id: int):
    """Close an election."""
    try:
        tx_hash = svc.close_election(election_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TransactionResponse(tx_hash=tx_hash)
