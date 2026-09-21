import logging

from fastapi import APIRouter

from app.dependencies import ControlPlaneDep, CurrentUser, LlmDep, SettingsDep
from app.errors import QueryLimitExceededError
from app.schemas import (
    ClarifyRequest,
    ClarifyResponse,
    LinkSchemaRequest,
    LinkSchemaResponse,
    TranslateRequest,
    TranslateResponse,
    UsageInfo,
    ValidateRequest,
    ValidateResponse,
)
from app.services.guardrail import validate_sql
from app.services.text_matching import fold_text_comparisons

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

    # The model cannot see how values are capitalized, so "gujarat" would
    # miss "Gujarat". Folded before the guardrail, so the guardrail inspects
    # the SQL that actually runs.
    raw_sql, folded = fold_text_comparisons(raw_sql, payload.dialect, payload.schema_ddl)

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
        case_insensitive_columns=folded,
        usage=usage,
    )


def _catalog_names(catalog: list[str]) -> list[str]:
    """
    Recover the table name from each catalog line (`name(col, col)`).

    This list is what the model's reply is validated against, so a name that
    cannot be recovered here can never be selected — failing closed is the
    right direction for the one check that stops a hallucinated table.
    """
    names = []
    for entry in catalog:
        name = entry.split("(", 1)[0].strip()
        if name:
            names.append(name)
    return names


@router.post("/link-schema", response_model=LinkSchemaResponse)
async def link_schema(payload: LinkSchemaRequest, user: CurrentUser, llm: LlmDep) -> LinkSchemaResponse:
    """
    Pick the tables a question needs, by reading what each table stores.

    This exists because neither keyword matching nor embeddings can tell
    that a table called `signup` is where users live while `ai_user_events`
    is an unrelated log — both rank the decoy higher, because for short
    identifiers both are ultimately driven by literal token overlap. A model
    reading the columns gets it right.

    Authenticated but **not metered**, on the same reasoning as `/v1/embed`:
    a user's allowance counts questions answered, and this runs in service
    of a translation that is already metered. Charging twice for one
    question would make the accurate path the expensive one. The catalog
    size caps in `LinkSchemaRequest` bound the cost instead.

    Selection is advisory. The client falls back to local lexical pruning if
    this fails, and the returned names are filtered against the submitted
    catalog so nothing invented reaches the blueprint.
    """
    known = _catalog_names(payload.catalog)
    tables = await llm.link_schema(payload.question, payload.catalog, known)

    logger.info(
        "link_schema user=%s catalog=%s selected=%s",
        user.user_id,
        len(known),
        ",".join(tables) or "-",
    )

    return LinkSchemaResponse(tables=tables)


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


@router.post("/clarify", response_model=ClarifyResponse)
async def clarify(payload: ClarifyRequest, user: CurrentUser, llm: LlmDep, settings: SettingsDep) -> ClarifyResponse:
    """
    One turn of agent talk: decide whether the question is clear enough to
    translate, and if not, ask the user one schema-grounded question.

    The pruned blueprint is what keeps this honest. The model only offers
    readings the connected schema can answer ("most orders" vs "highest
    spend" only when an amount column exists), and says early when the
    data is missing instead of letting the translator discover it.

    Authenticated but **not metered**, on the same reasoning as
    `/v1/link-schema`: it runs in service of one translation that already
    is. `max_clarify_turns` bounds the cost instead — once the budget is
    spent, the reply is forced to "ready" regardless of what the model says.
    """
    history = [(turn.role, turn.content) for turn in payload.history]
    result = await llm.clarify(payload.question, payload.schema_ddl, history, settings.max_clarify_turns)

    logger.info(
        "clarify user=%s turns=%s status=%s",
        user.user_id,
        sum(1 for role, _ in history if role == "assistant"),
        result.status,
    )

    return result
