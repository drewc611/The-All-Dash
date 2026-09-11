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
    db_pool_size: int = Field(default=5, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=200)
    expose_docs: bool = Field(default=False, description="Serve /docs and /openapi.json in production too")
    max_body_bytes: int = Field(default=1_048_576, ge=16_384, description="Largest request body accepted")

    # The web tier. Native scrape, map, crawl and batch need nothing; search,
    # rendering and screenshots use Firecrawl when a key is set; extract and
    # agent use the model below when one is set.
    web_user_agent: str = "AllDash/0.1 (+https://github.com/drewc611/The-All-Dash)"
    web_timeout_seconds: float = Field(default=20.0, ge=3, le=120)
    web_max_bytes: int = Field(default=5 * 1024 * 1024, ge=65_536, le=50 * 1024 * 1024)
    web_max_pages: int = Field(default=200, ge=1, le=2000, description="Largest crawl or batch, run by the worker")
    web_sync_max_pages: int = Field(
        default=25, ge=1, le=200, description="Largest crawl or batch answered inside a request"
    )
    web_per_host_interval: float = Field(default=0.5, ge=0, le=30)
    web_respect_robots: bool = True
    web_allow_private: bool = Field(default=False, description="Let the scraper reach private addresses (tests only)")
    web_request_budget_seconds: float = Field(
        default=60.0, ge=5, le=600, description="Wall-clock cap on one synchronous web request"
    )
    firecrawl_api_key: str = ""
    firecrawl_url: str = "https://api.firecrawl.dev"
    llm_provider: Literal["", "anthropic", "openai", "ollama"] = ""
    llm_model: str = ""
    llm_api_key: str = ""
    llm_base_url: str = ""

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

    @property
    def docs_enabled(self) -> bool:
        # The schema is public information locally; on a cluster it is a map
        # of every write endpoint, so it stays off unless asked for.
        return self.environment != "production" or self.expose_docs

    def validate_for_environment(self) -> None:
        if self.environment == "production" and not self.api_key_set:
            raise RuntimeError("ALLDASH_API_KEYS must be set in production")


@lru_cache
def get_settings() -> Settings:
    return Settings()
