"""Pydantic schemas for all API request/response models."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Elections
# ---------------------------------------------------------------------------

class ElectionCreate(BaseModel):
    name: str = Field(..., description="Name of the election")
    description: str = Field(..., description="Description of the election")
    start_time: int = Field(..., description="Unix timestamp for election start")
    end_time: int = Field(..., description="Unix timestamp for election end")


class ElectionResponse(BaseModel):
    id: int
    name: str
    description: str
    start_time: int
    end_time: int
    is_open: bool
    is_closed: bool


class TransactionResponse(BaseModel):
    tx_hash: str
    status: str = "submitted"


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------

class CandidateCreate(BaseModel):
    name: str = Field(..., description="Candidate name")
    description: str = Field(..., description="Candidate description")


class CandidateResponse(BaseModel):
    number: int
    name: str
    description: str


# ---------------------------------------------------------------------------
# Voters
# ---------------------------------------------------------------------------

class VoterHashesRegister(BaseModel):
    hashes: List[int] = Field(
        ..., description="Array of Poseidon hashes representing registered voters"
    )


class MerkleRootUpdate(BaseModel):
    merkle_root: int = Field(..., description="Merkle root computed from voter hashes")


class VoterHashesResponse(BaseModel):
    hashes: List[int]


# ---------------------------------------------------------------------------
# Votes
# ---------------------------------------------------------------------------

class VoteSubmit(BaseModel):
    proof: List[int] = Field(
        ...,
        min_length=8,
        max_length=8,
        description="ZK-SNARK proof array — exactly 8 elements (Groth16 uint256[8])",
    )
    public_signals: List[int] = Field(
        ..., description="Public signals for the ZK-SNARK proof"
    )


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

class CandidateResult(BaseModel):
    candidate_number: int
    vote_count: int


class ElectionResults(BaseModel):
    election_id: int
    results: List[CandidateResult]
