"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import elections, results, voters, votes

app = FastAPI(
    title="Votação ZK Backend",
    description=(
        "Stateless backend for an electronic voting system using ZK-SNARKs and blockchain. "
        "Acts as a facilitator between the frontend and the Ethereum smart contract."
    ),
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(elections.router)
app.include_router(voters.router)
app.include_router(votes.router)
app.include_router(results.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
def health_check():
    """Simple health-check endpoint."""
    return {"status": "ok"}
