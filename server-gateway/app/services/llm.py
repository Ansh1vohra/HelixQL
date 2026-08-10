"""
Context-insulated LLM synthesis engine (Step 3.4 / FR-3.3).

This module is the only place in the entire system that holds the master
model credentials. The desktop binary never sees them — that separation is
the reason the gateway tier exists at all.
"""

import logging
from typing import Protocol

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import Settings
from app.errors import LlmUnavailableError, TranslationError
from app.services.prompts import (
    REPAIR_SYSTEM_INSTRUCTION,
    SCHEMA_LINKER_SYSTEM_INSTRUCTION,
    TRANSLATOR_SYSTEM_INSTRUCTION,
    build_repair_prompt,
    build_schema_link_prompt,
    build_translation_prompt,
)
from app.services.sql_output import clean_sql, parse_table_list, strip_code_fences

logger = logging.getLogger(__name__)


class _RetryableRateLimit(Exception):
    """
    Internal marker for a provider-side 429.

    Exists so the retry policy can back off and try again instead of
    failing the user's query on the first burst. Never escapes this module:
    `_call_model` converts an exhausted retry into `LlmUnavailableError`.
    """

# Re-exported under their original private names: several tests and call
# sites import these from here, and the logic now lives in sql_output so
# every provider engine shares one definition.
_strip_code_fences = strip_code_fences
_clean_sql = clean_sql


class GeminiSynthesisEngine:
    """
    Wraps the Google GenAI SDK with HelixQL's fixed generation settings.

    Temperature is pinned to the configured value (0.0 per spec) so the same
    question against the same schema yields the same SQL — a translator, not
    a writer.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(timeout=int(settings.gemini_timeout_seconds * 1000)),
        )

    def _thinking_config(self) -> types.ThinkingConfig | None:
        """
        Gemini 3.x takes `thinking_level`, Gemini 2.5 takes
        `thinking_budget`, and each rejects the other's field with a 400. So
        send at most one, chosen by configuration rather than by sniffing the
        model name — model naming changes faster than this code does.
        """
        if self._settings.gemini_thinking_budget is not None:
            return types.ThinkingConfig(thinking_budget=self._settings.gemini_thinking_budget)
        if self._settings.gemini_thinking_level.strip():
            return types.ThinkingConfig(thinking_level=self._settings.gemini_thinking_level.strip())
        return None

    def _config(self, system_instruction: str, max_output_tokens: int | None = None) -> types.GenerateContentConfig:
        return types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=self._settings.gemini_temperature,
            max_output_tokens=max_output_tokens or self._settings.gemini_max_output_tokens,
            candidate_count=1,
            thinking_config=self._thinking_config(),
        )

    @retry(
        retry=retry_if_exception_type((genai_errors.ServerError, _RetryableRateLimit)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    async def _generate(self, prompt: str, config: types.GenerateContentConfig) -> str:
        try:
            response = await self._client.aio.models.generate_content(
                model=self._settings.gemini_model,
                contents=prompt,
                config=config,
            )
        except genai_errors.ClientError as exc:
            # 429 from the provider is our capacity problem, not the
            # customer's quota — their allowance is metered separately.
            # Raised as a private type so the retry policy above backs off
            # and tries again; only the final failure reaches the client.
            if exc.code == 429:
                logger.warning("Gemini rate limited the gateway — backing off")
                raise _RetryableRateLimit(str(exc)) from exc
            logger.error("Gemini rejected the request: %s", exc)
            raise LlmUnavailableError("The translation service rejected the request.") from exc
        except genai_errors.ServerError:
            # Must be re-raised, not wrapped: ServerError subclasses
            # APIError, so the generic handler below would otherwise swallow
            # it here and the retry policy would never see it.
            logger.warning("Gemini server error — backing off")
            raise
        except genai_errors.APIError as exc:
            logger.error("Gemini API error: %s", exc)
            raise LlmUnavailableError("The translation service is temporarily unavailable.") from exc
        except Exception as exc:  # network timeouts surface as bare httpx errors
            logger.error("Unexpected error calling Gemini: %s", exc)
            raise LlmUnavailableError("The translation service could not be reached.") from exc

        text = (response.text or "").strip()
        if not text:
            # Usually a safety block or a MAX_TOKENS cutoff. Both are dead
            # ends for this request, so report rather than retry blindly.
            finish_reason = None
            if response.candidates:
                finish_reason = getattr(response.candidates[0], "finish_reason", None)
            logger.warning("Gemini returned an empty response (finish_reason=%s)", finish_reason)
            raise TranslationError(
                "The translation service returned an empty response.",
                {"finish_reason": str(finish_reason) if finish_reason else None},
            )
        return text

    async def _call_model(self, prompt: str, config: types.GenerateContentConfig) -> str:
        """Runs the retrying generate call and translates a rate limit that
        survived every backoff into the client-facing error."""
        try:
            return await self._generate(prompt, config)
        except _RetryableRateLimit as exc:
            logger.warning("Gemini still rate limiting after retries")
            raise LlmUnavailableError("The translation service is busy. Please retry in a moment.") from exc
        except genai_errors.ServerError as exc:
            logger.error("Gemini still failing after retries: %s", exc)
            raise LlmUnavailableError("The translation service is temporarily unavailable.") from exc

    async def translate(self, question: str, schema_ddl: list[str], dialect: str) -> str:
        config = self._config(TRANSLATOR_SYSTEM_INSTRUCTION.format(dialect=dialect.upper()))
        raw = await self._call_model(build_translation_prompt(question, schema_ddl), config)
        return _clean_sql(raw)

    async def repair(
        self,
        question: str,
        schema_ddl: list[str],
        dialect: str,
        failed_sql: str,
        error: str,
        attempt: int,
    ) -> str:
        config = self._config(REPAIR_SYSTEM_INSTRUCTION.format(dialect=dialect.upper()))
        raw = await self._call_model(
            build_repair_prompt(question, schema_ddl, failed_sql, error, attempt),
            config,
        )
        return _clean_sql(raw)

    async def link_schema(self, question: str, catalog: list[str], known: list[str]) -> list[str]:
        # A table list is a handful of tokens; capping output here keeps a
        # model that decides to explain itself from burning the budget.
        config = self._config(SCHEMA_LINKER_SYSTEM_INSTRUCTION, max_output_tokens=256)
        raw = await self._call_model(build_schema_link_prompt(question, catalog), config)
        return parse_table_list(raw, known)


# --- Provider selection ---------------------------------------------------


class SynthesisEngine(Protocol):
    """
    What the translate router depends on. Both engines satisfy it, so the
    rest of the gateway — including the guardrail, which is what actually
    keeps the system safe — is indifferent to which provider is configured.
    """

    async def translate(self, question: str, schema_ddl: list[str], dialect: str) -> str: ...

    async def repair(
        self,
        question: str,
        schema_ddl: list[str],
        dialect: str,
        failed_sql: str,
        error: str,
        attempt: int,
    ) -> str: ...

    async def link_schema(self, question: str, catalog: list[str], known: list[str]) -> list[str]: ...


def create_engine(settings: Settings) -> SynthesisEngine:
    settings.require_provider_key()
    if settings.llm_provider == "groq":
        from app.services.groq import GroqSynthesisEngine

        logger.info("Using Groq for SQL synthesis (model=%s)", settings.groq_model)
        return GroqSynthesisEngine(settings)

    logger.info("Using Gemini for SQL synthesis (model=%s)", settings.gemini_model)
    return GeminiSynthesisEngine(settings)
