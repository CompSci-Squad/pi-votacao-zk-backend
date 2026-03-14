"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    rpc_url: str = "http://localhost:8545"
    contract_address: str = ""
    admin_private_key: str = ""
    # Comma-separated list of allowed CORS origins; use "*" for development only
    cors_origins: str = "*"


settings = Settings()
