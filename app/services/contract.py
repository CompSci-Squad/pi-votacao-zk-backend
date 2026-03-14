"""High-level contract interaction functions used by the routers."""

from __future__ import annotations

from typing import List

from app.services.blockchain import blockchain_service as bc


# ---------------------------------------------------------------------------
# Elections
# ---------------------------------------------------------------------------

def create_election(name: str, description: str, start_time: int, end_time: int) -> str:
    return bc.send("createElection", name, description, start_time, end_time)


def get_election(election_id: int) -> dict:
    result = bc.call("getElection", election_id)
    name, description, start_time, end_time, is_open, is_closed = result
    return {
        "id": election_id,
        "name": name,
        "description": description,
        "start_time": start_time,
        "end_time": end_time,
        "is_open": is_open,
        "is_closed": is_closed,
    }


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------

def add_candidate(election_id: int, name: str, description: str) -> str:
    return bc.send("addCandidate", election_id, name, description)


def get_candidate(election_id: int, candidate_number: int) -> dict:
    result = bc.call("getCandidate", election_id, candidate_number)
    name, description, number = result
    return {"number": number, "name": name, "description": description}


def get_candidates(election_id: int) -> list[dict]:
    count = bc.call("getCandidateCount", election_id)
    candidates = []
    for i in range(1, int(count) + 1):
        candidates.append(get_candidate(election_id, i))
    return candidates


# ---------------------------------------------------------------------------
# Voters
# ---------------------------------------------------------------------------

def register_voter_hashes(election_id: int, hashes: List[int]) -> str:
    return bc.send("registerVoterHashes", election_id, hashes)


def set_merkle_root(election_id: int, merkle_root: int) -> str:
    return bc.send("setMerkleRoot", election_id, merkle_root)


def get_voter_hashes(election_id: int) -> List[int]:
    return bc.call("getVoterHashes", election_id)


# ---------------------------------------------------------------------------
# Election lifecycle
# ---------------------------------------------------------------------------

def open_election(election_id: int) -> str:
    return bc.send("openElection", election_id)


def close_election(election_id: int) -> str:
    return bc.send("closeElection", election_id)


# ---------------------------------------------------------------------------
# Votes
# ---------------------------------------------------------------------------

def cast_vote(election_id: int, proof: List[int], public_signals: List[int]) -> str:
    return bc.send("castVote", election_id, proof, public_signals)


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

def get_results(election_id: int) -> dict:
    candidate_numbers, vote_counts = bc.call("getResults", election_id)
    results = [
        {"candidate_number": int(cn), "vote_count": int(vc)}
        for cn, vc in zip(candidate_numbers, vote_counts)
    ]
    return {"election_id": election_id, "results": results}
