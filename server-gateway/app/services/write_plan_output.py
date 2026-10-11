"""
Normalization of the write planner's reply into a `WritePlanResponse`.

Unlike the clarifier, an unreadable reply is *not* papered over with a
guess: a write built from a misparsed plan is the one failure that cannot be
undone. An unusable reply becomes an `ask` for the user to rephrase.
"""

import logging

from pydantic import ValidationError

from app.schemas import WritePlan, WritePlanResponse
from app.services.clarify_output import MAX_MESSAGE_LENGTH, MAX_OPTIONS, _clean_list, _clean_text, _extract_object

logger = logging.getLogger(__name__)

_REPHRASE = WritePlanResponse(
    status="ask",
    message="I couldn't turn that into a change I'm sure about. Could you say it again, a bit more specifically?",
)


def parse_write_plan(text: str, budget_spent: bool) -> WritePlanResponse:
    parsed = _extract_object(text)
    if parsed is None:
        logger.warning("Write planner reply was not a JSON object")
        return _REPHRASE

    status = parsed.get("status")

    if status == "read":
        return WritePlanResponse(status="read")

    if status == "ask":
        message = _clean_text(parsed.get("question"), MAX_MESSAGE_LENGTH)
        if budget_spent:
            return WritePlanResponse(
                status="unanswerable",
                message="This took too many questions to pin down. Please start again with all the details at once.",
            )
        if not message:
            return _REPHRASE
        return WritePlanResponse(status="ask", message=message, options=_clean_list(parsed.get("options"), MAX_OPTIONS))

    if status == "ready":
        try:
            plan = WritePlan.model_validate(parsed.get("plan"))
        except ValidationError as exc:
            logger.warning("Write planner returned an invalid plan: %s", exc.errors()[:3])
            return _REPHRASE
        # Belt and braces with the client, which refuses these too.
        if plan.operation in ("update", "delete") and not plan.where:
            return WritePlanResponse(
                status="ask",
                message=f"Which rows should this {plan.operation} apply to? Please describe them exactly.",
            )
        return WritePlanResponse(status="ready", plan=plan)

    if status == "unanswerable":
        reason = _clean_text(parsed.get("reason"), MAX_MESSAGE_LENGTH)
        return WritePlanResponse(status="unanswerable", message=reason or "This change can't be made with this schema.")

    logger.warning("Write planner returned unknown status %r", status)
    return _REPHRASE
