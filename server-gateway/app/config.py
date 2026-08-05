from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

LlmProvider = Literal["gemini", "groq"]


class Settings(BaseSettings):
    """
    Gateway configuration. Required fields have no default so the app fails
    fast with a readable error at startup if misconfigured, rather than
    failing deep inside a request handler later (mirrors the control
    plane's `getEnv()` validation approach).
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Which provider synthesizes SQL. The spec names Gemini, but the choice
    # is swappable: translation is a small, well-specified task and the
    # guardrail downstream doesn't care who produced the string. Groq is
    # markedly faster and has a far more generous free tier, which matters
    # because Gemini's free tier caps at ~20 requests per day per model.
    llm_provider: LlmProvider = "gemini"

    # Google GenAI SDK — synthesizes SQL via Gemini (FR-3.3).
    # Optional when llm_provider is "groq"; validated on startup either way.
    gemini_api_key: str = ""
    # The spec names gemini-2.5-flash, but Google has since closed that model
    # to new API keys (it 404s with "no longer available to new users"), so
    # the default tracks the current Flash generation instead. Override with
    # GEMINI_MODEL if your key still has 2.5 access.
    gemini_model: str = "gemini-3.6-flash"
    # Zero temperature is a spec requirement, not a tunable default: the
    # model must behave as a deterministic translator, never a writer.
    gemini_temperature: float = 0.0
    gemini_timeout_seconds: float = 45.0
    gemini_max_output_tokens: int = 2048

    # Extended thinking is turned down for translation work: it costs latency
    # and adds output variance on a task that wants neither. The two model
    # generations spell this differently and each rejects the other's field,
    # so exactly one is sent — see `thinking_config()`.
    #   Gemini 3.x: thinking_level ("low" / "high")
    #   Gemini 2.5: thinking_budget (0 disables, -1 is dynamic)
    # Blank both to let the model decide.
    gemini_thinking_level: str = "low"
    gemini_thinking_budget: int | None = None

    # Groq — OpenAI-compatible chat completions API.
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_temperature: float = 0.0
    groq_timeout_seconds: float = 45.0
    groq_max_output_tokens: int = 2048

    def require_provider_key(self) -> None:
        """
        Fail fast at startup if the selected provider has no key, rather
        than at the first query with an opaque upstream error.
        """
        if self.llm_provider == "gemini" and not self.gemini_api_key.strip():
            raise ValueError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini")
        if self.llm_provider == "groq" and not self.groq_api_key.strip():
            raise ValueError("GROQ_API_KEY is required when LLM_PROVIDER=groq")

    # The control plane's /api/internal/* endpoints this gateway calls to
    # validate api_tokens and meter usage, instead of querying MongoDB
    # directly (see the Phase 1 architecture note on why).
    control_plane_base_url: str = "http://localhost:3000"
    control_plane_internal_secret: str
    control_plane_timeout_seconds: float = 10.0

    # Self-healing loop bound (FR-4.5). The desktop client counts attempts
    # locally, but the gateway enforces the same ceiling so a misbehaving or
    # modified client can't spin the LLM indefinitely on one question.
    max_repair_attempts: int = 3

    # Hard ceiling applied to generated SELECTs that carry no LIMIT of their
    # own, so a vague question can't pull a whole table into desktop memory.
    max_result_rows: int = 1000

    # Desktop clients are native apps (no browser Origin), so CORS is off by
    # default. Set to a comma-separated list only if a browser-based client
    # ever needs to reach the gateway directly.
    cors_allow_origins: str = ""

    log_level: str = "INFO"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
