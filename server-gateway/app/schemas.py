from typing import Literal

from pydantic import BaseModel, Field, field_validator

# The dialects the desktop client ships native drivers for (mysql2 / pg).
# Kept as a closed set so an unknown value fails validation up front rather
# than reaching SQLGlot as an unparseable dialect name.
Dialect = Literal["mysql", "postgres"]


class RepairContext(BaseModel):
    """
    Self-healing input (FR-4.5). The desktop client sends back the SQL that
    failed plus the driver's raw error text so the model can correct its own
    mistake — typically a hallucinated column or a bad join.
    """

    sql: str = Field(min_length=1, max_length=20_000)
    error: str = Field(min_length=1, max_length=8_000)
    attempt: int = Field(ge=1, le=10, description="1-based index of this retry")


class TranslateRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)
    # Empty CREATE TABLE blueprints only — the client's local RAG step has
    # already pruned this to the tables the question actually needs, and it
    # never contains row data (FR-2.5).
    schema_ddl: list[str] = Field(min_length=1, max_length=80)
    dialect: Dialect = "mysql"
    repair: RepairContext | None = None

    @field_validator("schema_ddl")
    @classmethod
    def _reject_oversized_ddl(cls, value: list[str]) -> list[str]:
        for statement in value:
            if not statement.strip():
                raise ValueError("schema_ddl entries must not be empty")
            if len(statement) > 20_000:
                raise ValueError("schema_ddl entries must be 20000 characters or fewer")
        return value


class UsageInfo(BaseModel):
    remaining: int
    monthly_query_limit: int


class TranslateResponse(BaseModel):
    sql: str
    dialect: Dialect
    attempt: int = Field(description="1 for a first translation, 2+ for a self-heal retry")
    # Tables the guardrail actually saw in the AST. The dashboard shows these
    # so an admin can confirm the query touched only what they expected.
    tables: list[str] = []
    limit_applied: int | None = Field(
        default=None,
        description="Row cap the gateway injected, or null if the query carried its own LIMIT",
    )
    usage: UsageInfo | None = None


class ValidateRequest(BaseModel):
    """Runs the guardrail alone — used by the desktop app's manual SQL editor
    and by the test suite. No LLM call, so no usage is metered."""

    sql: str = Field(min_length=1, max_length=20_000)
    dialect: Dialect = "mysql"


class ValidateResponse(BaseModel):
    sql: str
    tables: list[str]
    limit_applied: int | None = None
