import logging
from datetime import date

from fastapi import APIRouter

from app.dependencies import ControlPlaneDep, CurrentUser, LlmDep, SettingsDep
from app.schemas import WritePlanRequest, WritePlanResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/beta", tags=["beta"])


@router.post("/write-plan", response_model=WritePlanResponse)
async def write_plan(
    payload: WritePlanRequest,
    user: CurrentUser,
    llm: LlmDep,
    control_plane: ControlPlaneDep,
    settings: SettingsDep,
) -> WritePlanResponse:
    """
    Beta write mode: one turn of planning an insert, update, or delete.

    Returns a structured plan, never SQL. The desktop client validates the
    plan against the live schema, builds a parameterized statement itself,
    previews the affected rows locally, and runs it only after the user
    confirms — so nothing this endpoint returns can reach a database on its
    own. The AST guardrail on `/v1/translate` is untouched: it still refuses
    every write the model writes as SQL.

    Metering mirrors `/v1/translate`: the opening turn of a write
    conversation is one query, follow-up turns are free and bounded by
    `max_write_turns`. A turn that turns out to be a read is not metered
    here, because the client then runs it through the ordinary pipeline,
    which meters it there.
    """
    history = [(turn.role, turn.content) for turn in payload.history]
    context = [(prior.question, prior.resolved_question) for prior in payload.context]
    result = await llm.plan_write(
        payload.question,
        payload.schema_ddl,
        history,
        date.today().isoformat(),
        settings.max_write_turns,
        context=context,
    )

    if result.status in ("ask", "ready") and not history:
        await control_plane.increment_usage(user.user_id)

    logger.info(
        "write_plan user=%s turns=%s status=%s operation=%s",
        user.user_id,
        sum(1 for role, _ in history if role == "assistant"),
        result.status,
        result.plan.operation if result.plan else "-",
    )
    return result
