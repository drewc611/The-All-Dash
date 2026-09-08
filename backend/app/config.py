from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["local", "test", "production"]


class Settings(BaseSettings):
    """Every knob the service reads, from ALLDASH_* environment variables.

    Production refuses to start without API keys: an open write API on a
    cluster is a misconfiguration, not a default.
    """

    model_config = SettingsConfigDict(env_prefix="ALLDASH_", env_file=".env", extra="ignore")

    app_name: str = "All Dash Platform API"
    environment: Environment = "local"
    database_url: str = "postgresql+asyncpg://alldash:alldash@localhost:5432/alldash"
    redis_url: str = "redis://localhost:6379/0"
    api_keys: str = Field(default="", description="Comma-separated list of accepted X-API-Key values")
    cors_origins: str = "http://localhost:3000"
    timezone: str = "UTC"
    daily_brief_hour: int = Field(default=4, ge=0, le=23)
    burn_rate_window_days: int = Field(default=30, ge=7, le=365)
    log_level: str = "INFO"
    request_id_header: str = "x-request-id"

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, value: str) -> str:
        # Accept the plain scheme people paste from consoles and upgrade it to the async driver.
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        return value

    @property
    def api_key_set(self) -> frozenset[str]:
        return frozenset(k.strip() for k in self.api_keys.split(",") if k.strip())

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def auth_required(self) -> bool:
        # Local development without keys is allowed; anything else must present a key.
        return self.environment != "local" or bool(self.api_key_set)

    def validate_for_environment(self) -> None:
        if self.environment == "production" and not self.api_key_set:
            raise RuntimeError("ALLDASH_API_KEYS must be set in production")


@lru_cache
def get_settings() -> Settings:
    return Settings()
