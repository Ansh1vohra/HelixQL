"""
Groq synthesis engine — an alternative to Gemini behind the same interface.

Groq serves open-weight models over an OpenAI-compatible API. Two reasons it
earns a place here: its free tier is measured in thousands of requests per
day rather than ~20, and its inference is fast enough that translation stops
being the slow step in the pipeline.

Called through plain `httpx` rather than the OpenAI SDK — the surface used
is one POST, and the gateway already depends on httpx for the control plane.
"""

import logging
from typing import Any

import httpx
from tenacity import RetryCallState, retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import Settings
from app.errors import LlmUnavailableError, TranslationError
from app.schemas import ClarifyResponse, WritePlanResponse
from app.services.clarify_output import parse_clarification
from app.services.prompts import (
    CLARIFIER_SYSTEM_INSTRUCTION,
    REPAIR_SYSTEM_INSTRUCTION,
    SCHEMA_LINKER_SYSTEM_INSTRUCTION,
    TRANSLATOR_SYSTEM_INSTRUCTION,
    WRITE_PLANNER_SYSTEM_INSTRUCTION,
    build_clarify_prompt,
    build_repair_prompt,
    build_schema_link_prompt,
    build_translation_prompt,
    build_write_plan_prompt,
)
from app.services.write_plan_output import parse_write_plan
from app.services.sql_output import clean_sql, parse_table_list

logger = logging.getLogger(__name__)


# Longest Retry-After the gateway will sit through inside one request. Groq's
# per-minute token limit resets within seconds, and waiting it out turns a
# failed question into a slow one. A longer hint means a daily limit — no
# retry inside a request will clear that, so it fails fast with the wait.
MAX_RETRY_AFTER_SECONDS = 20.0


class _RetryableUpstream(Exception):
    """Internal marker for a retryable 429/5xx. Never escapes this module.
    Ollama's engine raises it too, so it is not private to Groq in practice."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """Groq sends Retry-After in seconds on a 429. Absent or unreadable
    means no hint, and the exponential backoff applies instead."""
    try:
        value = float(response.headers.get("retry-after", ""))
    except ValueError:
        return None
    return value if value >= 0 else None


_backoff = wait_exponential(multiplier=1, min=1, max=10)


def _wait(retry_state: RetryCallState) -> float:
    """Waits as long as the provider asked, when it said; otherwise backs off
    exponentially. A 1s-then-2s backoff against a limit that resets in 7s
    spends all three attempts inside the same window — which is exactly how
    agent talk, making several calls in a row, kept failing."""
    error = retry_state.outcome.exception() if retry_state.outcome else None
    hinted = getattr(error, "retry_after", None)
    if hinted is not None:
        # A little over the hint: the window is measured on their clock.
        return hinted + 0.5
    return _backoff(retry_state)


def _human_wait(seconds: float) -> str:
    if seconds < 90:
        return f"{round(seconds)} seconds"
    if seconds < 2 * 3600:
        return f"{round(seconds / 60)} minutes"
    return f"{round(seconds / 3600)} hours"


class GroqSynthesisEngine:
    """
    Mirrors `GeminiSynthesisEngine`: same methods, same return contract, same
    fixed generation settings. Temperature is pinned to the configured value
    (0.0 per spec) so translation stays deterministic.
    """

    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        # Injectable so tests can drive it with httpx.MockTransport.
        self._http = http or httpx.AsyncClient(timeout=settings.groq_timeout_seconds)

    @retry(
        retry=retry_if_exception_type(_RetryableUpstream),
        stop=stop_after_attempt(3),
        wait=_wait,
        reraise=True,
    )
    async def _generate(self, system_instruction: str, prompt: str) -> str:
        url = f"{self._settings.groq_base_url.rstrip('/')}/chat/completions"
        payload: dict[str, Any] = {
            "model": self._settings.groq_model,
            "temperature": self._settings.groq_temperature,
            "max_tokens": self._settings.groq_max_output_tokens,
            "n": 1,
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": prompt},
            ],
        }

        try:
            response = await self._http.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {self._settings.groq_api_key}"},
                timeout=self._settings.groq_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            logger.error("Groq request failed: %s", exc)
            raise LlmUnavailableError("The translation service could not be reached.") from exc

        if response.status_code == 429:
            retry_after = _retry_after_seconds(response)
            # The body names the limit that was hit (requests or tokens, per
            # minute or per day) — the one thing needed to tell a burst from
            # an exhausted quota, so it is logged.
            logger.warning("Groq rate limited the gateway (retry-after=%s): %s", retry_after, response.text[:300])
            if retry_after is not None and retry_after > MAX_RETRY_AFTER_SECONDS:
                raise LlmUnavailableError(
                    f"The AI provider's usage limit is reached. Try again in about {_human_wait(retry_after)}.",
                    {"retry_after_seconds": round(retry_after)},
                )
            raise _RetryableUpstream(response.text[:300], retry_after)
        if response.status_code >= 500:
            logger.warning("Groq server error %s — backing off", response.status_code)
            raise _RetryableUpstream(response.text[:300])
        if response.status_code == 401:
            logger.error("Groq rejected the API key")
            raise LlmUnavailableError("The translation service rejected the gateway's credentials.")
        if response.status_code >= 400:
            logger.error("Groq rejected the request: %s %s", response.status_code, response.text[:300])
            raise LlmUnavailableError("The translation service rejected the request.")

        try:
            body = response.json()
            choice = body["choices"][0]
            text = (choice["message"]["content"] or "").strip()
        except (ValueError, KeyError, IndexError) as exc:
            logger.error("Unexpected Groq response shape: %s", response.text[:300])
            raise TranslationError("The translation service returned an unreadable response.") from exc

        if not text:
            finish_reason = choice.get("finish_reason")
            logger.warning("Groq returned an empty response (finish_reason=%s)", finish_reason)
            raise TranslationError(
                "The translation service returned an empty response.",
                {"finish_reason": finish_reason},
            )
        return text

    async def _call_model(self, system_instruction: str, prompt: str) -> str:
        try:
            return await self._generate(system_instruction, prompt)
        except _RetryableUpstream as exc:
            logger.warning("Groq still failing after retries")
            raise LlmUnavailableError(
                "The AI provider is rate-limiting requests right now. Please retry in a minute."
                if exc.retry_after is not None
                else "The translation service is busy. Please retry in a moment."
            ) from exc

    async def translate(self, question: str, schema_ddl: list[str], dialect: str) -> str:
        raw = await self._call_model(
            TRANSLATOR_SYSTEM_INSTRUCTION.format(dialect=dialect.upper()),
            build_translation_prompt(question, schema_ddl),
        )
        return clean_sql(raw)

    async def repair(
        self,
        question: str,
        schema_ddl: list[str],
        dialect: str,
        failed_sql: str,
        error: str,
        attempt: int,
    ) -> str:
        raw = await self._call_model(
            REPAIR_SYSTEM_INSTRUCTION.format(dialect=dialect.upper()),
            build_repair_prompt(question, schema_ddl, failed_sql, error, attempt),
        )
        return clean_sql(raw)

    async def link_schema(self, question: str, catalog: list[str], known: list[str]) -> list[str]:
        raw = await self._call_model(
            SCHEMA_LINKER_SYSTEM_INSTRUCTION,
            build_schema_link_prompt(question, catalog),
        )
        return parse_table_list(raw, known)

    async def clarify(
        self,
        question: str,
        schema_ddl: list[str],
        history: list[tuple[str, str]],
        max_turns: int,
        context: list[tuple[str, str]] | None = None,
    ) -> ClarifyResponse:
        turns_used = sum(1 for role, _ in history if role == "assistant")
        raw = await self._call_model(
            CLARIFIER_SYSTEM_INSTRUCTION,
            build_clarify_prompt(question, schema_ddl, history, turns_used, max_turns, context),
        )
        return parse_clarification(raw, question, history, budget_spent=turns_used >= max_turns, context=context)

    async def plan_write(
        self,
        question: str,
        schema_ddl: list[str],
        history: list[tuple[str, str]],
        today: str,
        max_turns: int,
        context: list[tuple[str, str]] | None = None,
    ) -> WritePlanResponse:
        turns_used = sum(1 for role, _ in history if role == "assistant")
        raw = await self._call_model(
            WRITE_PLANNER_SYSTEM_INSTRUCTION,
            build_write_plan_prompt(question, schema_ddl, history, today, turns_used, max_turns, context),
        )
        return parse_write_plan(raw, budget_spent=turns_used >= max_turns)

    async def aclose(self) -> None:
        await self._http.aclose()
