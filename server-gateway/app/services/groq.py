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
from app.services.sql_output import clean_sql, parse_table_list

logger = logging.getLogger(__name__)


class _RetryableUpstream(Exception):
    """Internal marker for a retryable 429/5xx. Never escapes this module."""


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
        wait=wait_exponential(multiplier=1, min=1, max=10),
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
            logger.warning("Groq rate limited the gateway — backing off")
            raise _RetryableUpstream(response.text[:300])
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
            raise LlmUnavailableError("The translation service is busy. Please retry in a moment.") from exc

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

    async def aclose(self) -> None:
        await self._http.aclose()
