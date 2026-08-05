import logging

from fastapi import APIRouter

from app.dependencies import ControlPlaneDep, CurrentUser, LlmDep, SettingsDep
from app.errors import QueryLimitExceededError
from app.schemas import (
    TranslateRequest,
    TranslateResponse,
    UsageInfo,
    ValidateRequest,
    ValidateResponse,
)
from app.services.guardrail import validate_sql

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["translation"])


@router.post("/translate", response_model=TranslateResponse)
async def translate(
    payload: TranslateRequest,
    user: CurrentUser,
    llm: LlmDep,
    control_plane: ControlPlaneDep,
    settings: SettingsDep,
) -> TranslateResponse:
    """
    Turn one English question plus a pruned schema blueprint into one
    verified, read-only SQL string.

    Also serves the self-healing retry (FR-4.5) when `repair` is present:
    the desktop client sends back the SQL its database rejected along with
    the driver's raw error, and the model corrects itself.

    Metering: only a fresh translation consumes the user's monthly
    allowance. Self-heal retries are free, because they exist to fix the
    model's own mistake — charging three queries for one question would
    penalize the user for our error. The attempt ceiling
    (`max_repair_attempts`) is what stops the free path from being abused.
    """
    is_repair = payload.repair is not None
    usage: UsageInfo | None = None

    if is_repair:
        assert payload.repair is not None  # narrowed for type checkers
        if payload.repair.attempt > settings.max_repair_attempts:
            raise QueryLimitExceededError(
                f"Self-correction gave up after {settings.max_repair_attempts} attempts. "
                "Try rephrasing your question.",
                {"max_repair_attempts": settings.max_repair_attempts},
            )
    else:
        # Meter before invoking the model (FR-3.2), so a user at their cap
        # never reaches the paid pipeline at all.
        metered = await control_plane.increment_usage(user.user_id)
        usage = UsageInfo(remaining=metered["remaining"], monthly_query_limit=metered["monthly_query_limit"])

    if is_repair:
        assert payload.repair is not None
        raw_sql = await llm.repair(
            question=payload.question,
            schema_ddl=payload.schema_ddl,
            dialect=payload.dialect,
            failed_sql=payload.repair.sql,
            error=payload.repair.error,
            attempt=payload.repair.attempt,
        )
        attempt = payload.repair.attempt + 1
    else:
        raw_sql = await llm.translate(
            question=payload.question,
            schema_ddl=payload.schema_ddl,
            dialect=payload.dialect,
        )
        attempt = 1

    # Nothing the model produced reaches the client un-inspected.
    result = validate_sql(raw_sql, payload.dialect, max_rows=settings.max_result_rows)

    logger.info(
        "translate user=%s dialect=%s attempt=%s tables=%s",
        user.user_id,
        payload.dialect,
        attempt,
        ",".join(result.tables) or "-",
    )

    return TranslateResponse(
        sql=result.sql,
        dialect=payload.dialect,
        attempt=attempt,
        tables=result.tables,
        limit_applied=result.limit_applied,
        usage=usage,
    )


@router.post("/validate", response_model=ValidateResponse)
async def validate(payload: ValidateRequest, user: CurrentUser, settings: SettingsDep) -> ValidateResponse:
    """
    Run the AST guardrail on its own, with no model call and no metering.

    Lets the desktop app re-check hand-edited SQL through exactly the same
    code path that guards generated SQL, so an operator can't route around
    the guardrail by tweaking a query before running it.
    """
    result = validate_sql(payload.sql, payload.dialect, max_rows=settings.max_result_rows)
    return ValidateResponse(sql=result.sql, tables=result.tables, limit_applied=result.limit_applied)
