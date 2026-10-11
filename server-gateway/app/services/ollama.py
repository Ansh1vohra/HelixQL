"""
Ollama synthesis engine — a model running on the developer's own machine.

Same interface and prompts as the hosted engines, so the guardrail and every
route behave identically; only where the text comes from changes. Useful for
offline development and for not spending a hosted free tier on iteration.

Inherits everything from the Groq engine except the HTTP call. Ollama does
serve an OpenAI-compatible route that the Groq engine could hit unchanged,
but that route cannot set the context window, and Ollama's default window
is smaller than a schema blueprint plus the system prompt. Overflow is not
an error there — the prompt's head is silently dropped, and the system
instruction goes first. The native /api/chat takes `num_ctx`, so it is used
instead.

Expect lower accuracy from small local models than from the hosted ones.
The guardrail and the self-heal loop still apply, so a weak model produces
failed or rejected queries, never unsafe ones.
"""

import logging
import re
from typing import Any

import httpx

from app.config import Settings
from app.errors import LlmUnavailableError, TranslationError
from app.services.groq import GroqSynthesisEngine, _RetryableUpstream

logger = logging.getLogger(__name__)

# Reasoning models (qwen3, deepseek-r1) can lead with a <think> block even
# when asked for raw output; it would otherwise reach the SQL parser.
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


class OllamaSynthesisEngine(GroqSynthesisEngine):
    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        super().__init__(settings, http or httpx.AsyncClient(timeout=settings.ollama_timeout_seconds))

    async def _generate(self, system_instruction: str, prompt: str) -> str:
        settings = self._settings
        url = f"{settings.ollama_base_url.rstrip('/')}/api/chat"
        payload: dict[str, Any] = {
            "model": settings.ollama_model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": prompt},
            ],
            "options": {
                "temperature": settings.ollama_temperature,
                "num_ctx": settings.ollama_num_ctx,
                "num_predict": settings.ollama_max_output_tokens,
            },
        }

        try:
            response = await self._http.post(url, json=payload, timeout=settings.ollama_timeout_seconds)
        except httpx.TimeoutException as exc:
            logger.error("Ollama timed out after %ss", settings.ollama_timeout_seconds)
            raise LlmUnavailableError(
                "The local model took too long to answer. Try a smaller model or raise OLLAMA_TIMEOUT_SECONDS."
            ) from exc
        except httpx.HTTPError as exc:
            logger.error("Ollama request to %s failed: %s", url, exc)
            raise LlmUnavailableError(
                f"Ollama is not reachable at {settings.ollama_base_url}. Is `ollama serve` running?"
            ) from exc

        if response.status_code == 404:
            # Ollama's 404 here means the model is not pulled, not a bad URL.
            logger.error("Ollama does not have model %r: %s", settings.ollama_model, response.text[:300])
            raise LlmUnavailableError(
                f"The local model '{settings.ollama_model}' is not installed. Run: ollama pull {settings.ollama_model}"
            )
        if response.status_code >= 500:
            logger.warning("Ollama server error %s — backing off: %s", response.status_code, response.text[:300])
            raise _RetryableUpstream(response.text[:300])
        if response.status_code >= 400:
            logger.error("Ollama rejected the request: %s %s", response.status_code, response.text[:300])
            raise LlmUnavailableError("The local model rejected the request.")

        try:
            body = response.json()
            text = _THINK_BLOCK.sub("", body["message"]["content"] or "").strip()
        except (ValueError, KeyError, TypeError) as exc:
            logger.error("Unexpected Ollama response shape: %s", response.text[:300])
            raise TranslationError("The local model returned an unreadable response.") from exc

        if not text:
            done_reason = body.get("done_reason")
            logger.warning("Ollama returned an empty response (done_reason=%s)", done_reason)
            raise TranslationError("The local model returned an empty response.", {"done_reason": done_reason})
        return text
