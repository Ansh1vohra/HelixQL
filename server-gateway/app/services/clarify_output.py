"""
Normalization of the clarifier's reply into a `ClarifyResponse`.

The clarifier is advisory: a reply that cannot be parsed never fails the
user's question. It degrades to "ready" with a question assembled from what
the user already said, and the translator takes it from there — exactly the
path a question took before agent talk existed.
"""

import json
import logging
from typing import Any

from app.schemas import ClarifyResponse
from app.services.sql_output import strip_code_fences

logger = logging.getLogger(__name__)

MAX_OPTIONS = 4
MAX_OPTION_LENGTH = 120
MAX_MESSAGE_LENGTH = 500


def fallback_question(question: str, history: list[tuple[str, str]]) -> str:
    """The original question with the user's replies appended, for when the
    model's own resolution is unusable. Crude, but it loses nothing the user
    said, and the translator reads it fine."""
    answers = [content.strip() for role, content in history if role == "user" and content.strip()]
    if not answers:
        return question.strip()
    return f"{question.strip()} ({'; '.join(answers)})"


def _extract_object(text: str) -> dict[str, Any] | None:
    body = strip_code_fences(text)
    # Reasoning models sometimes lead with a sentence despite the contract;
    # the outermost braces are the object either way.
    start, end = body.find("{"), body.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(body[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _clean_text(value: Any, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _clean_list(value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    items = [_clean_text(item, MAX_OPTION_LENGTH) for item in value]
    return [item for item in items if item][:limit]


def parse_clarification(
    text: str,
    question: str,
    history: list[tuple[str, str]],
    budget_spent: bool,
) -> ClarifyResponse:
    """
    Turn the model's JSON reply into a response the client can act on.

    `budget_spent` is enforced here rather than trusted to the prompt: once
    the question budget is used up, an "ask" is converted to "ready", so an
    unmetered endpoint cannot be walked into an endless interview.
    """
    ready_fallback = ClarifyResponse(status="ready", resolved_question=fallback_question(question, history))

    parsed = _extract_object(text)
    if parsed is None:
        logger.warning("Clarifier reply was not a JSON object; proceeding with the question as asked")
        return ready_fallback

    status = parsed.get("status")

    if status == "ask":
        message = _clean_text(parsed.get("question"), MAX_MESSAGE_LENGTH)
        if budget_spent or not message:
            return ready_fallback
        return ClarifyResponse(status="ask", message=message, options=_clean_list(parsed.get("options"), MAX_OPTIONS))

    if status == "ready":
        resolved = _clean_text(parsed.get("resolved_question"), 2_000)
        return ClarifyResponse(
            status="ready",
            resolved_question=resolved or ready_fallback.resolved_question,
            assumptions=_clean_list(parsed.get("assumptions"), 6),
        )

    if status == "unanswerable":
        reason = _clean_text(parsed.get("reason"), MAX_MESSAGE_LENGTH)
        return ClarifyResponse(
            status="unanswerable",
            message=reason or "The connected schema does not store the data this question needs.",
        )

    logger.warning("Clarifier returned unknown status %r; proceeding with the question as asked", status)
    return ready_fallback
