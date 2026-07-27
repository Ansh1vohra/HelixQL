from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Gateway configuration. Required fields have no default so the app fails
    fast with a readable error at startup if misconfigured, rather than
    failing deep inside a request handler later (mirrors the control
    plane's `getEnv()` validation approach).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Google GenAI SDK — used in Phase 3 to synthesize SQL via Gemini.
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"
    gemini_temperature: float = 0.0

    # The control plane's /api/internal/* endpoints this gateway calls to
    # validate api_tokens and meter usage, instead of querying MongoDB
    # directly (see the Phase 1 architecture note on why).
    control_plane_base_url: str = "http://localhost:3000"
    control_plane_internal_secret: str


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
