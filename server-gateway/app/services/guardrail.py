"""
Programmatic AST security pipeline (Step 3.3 / FR-3.4 / FR-3.5).

Everything the language model produces passes through here before it is
allowed anywhere near a customer database. The check is structural, not
textual: the string is compiled into a SQLGlot expression tree and every
node in that tree is inspected. A denylist of substrings would be trivially
defeated by comments, casing, or string literals containing the word
"DROP"; a tree walk is not.
"""

from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError, SqlglotError

from app.errors import SecurityViolationError, TranslationError

# Maps our public dialect names onto SQLGlot's. Both of the desktop
# client's native drivers (mysql2, pg) are represented.
SQLGLOT_DIALECTS: dict[str, str] = {"mysql": "mysql", "postgres": "postgres"}


def _expressions(*names: str) -> tuple[type[exp.Expression], ...]:
    """
    Resolve SQLGlot expression classes by name, skipping any that a given
    SQLGlot release doesn't define. The library reshuffles its expression
    hierarchy between majors; a missing class must not crash the guardrail
    at import time, and every name we care about is defensive-only.
    """
    return tuple(getattr(exp, name) for name in names if hasattr(exp, name))


# Any of these appearing *anywhere* in the tree fails the query — including
# inside a CTE, a subquery, or a data-modifying WITH clause.
FORBIDDEN_NODES: tuple[type[exp.Expression], ...] = _expressions(
    # Data mutation
    "Insert",
    "Update",
    "Delete",
    "Merge",
    "Upsert",
    # Schema mutation / destruction
    "Create",
    "Drop",
    "Alter",
    "AlterTable",
    "AlterColumn",
    "TruncateTable",
    "Rename",
    "RenameTable",
    # Privilege and session control
    "Grant",
    "Revoke",
    "Set",
    "SetItem",
    "Use",
    "Transaction",
    "Commit",
    "Rollback",
    # Filesystem / external I/O — `SELECT ... INTO OUTFILE`, COPY, ATTACH
    "Into",
    "Copy",
    "Export",
    "Attach",
    "Detach",
    "LoadData",
    # Row locking: read-only in name only, it blocks other writers
    "Lock",
    # SQLGlot's catch-all for statements it does not model structurally
    # (CALL, SHOW, vendor-specific DDL). Unmodelled means uninspectable, so
    # it is refused rather than trusted.
    "Command",
)

# Functions that read files, execute shell commands, advance sequences, or
# stall the server. They parse as ordinary function calls inside a perfectly
# legal SELECT, so the node-type walk above cannot catch them.
FORBIDDEN_FUNCTIONS: frozenset[str] = frozenset(
    {
        # MySQL
        "LOAD_FILE",
        "SLEEP",
        "BENCHMARK",
        "GET_LOCK",
        "RELEASE_LOCK",
        "SYS_EXEC",
        "SYS_EVAL",
        # PostgreSQL
        "PG_SLEEP",
        "PG_SLEEP_FOR",
        "PG_READ_FILE",
        "PG_READ_BINARY_FILE",
        "PG_LS_DIR",
        "PG_TERMINATE_BACKEND",
        "PG_CANCEL_BACKEND",
        "PG_RELOAD_CONF",
        "LO_IMPORT",
        "LO_EXPORT",
        "DBLINK",
        "DBLINK_EXEC",
        "QUERY_TO_XML",
        # Sequence mutation — a write dressed up as a read
        "NEXTVAL",
        "SETVAL",
        # SQL Server, in case a dialect is added later
        "XP_CMDSHELL",
    }
)


@dataclass
class GuardrailResult:
    """The sanitized query plus what the walk observed about it."""

    sql: str
    tables: list[str] = field(default_factory=list)
    limit_applied: int | None = None


def _dialect_for(dialect: str) -> str:
    try:
        return SQLGLOT_DIALECTS[dialect]
    except KeyError:  # pragma: no cover - blocked by pydantic validation upstream
        raise SecurityViolationError(f"Unsupported SQL dialect: {dialect}") from None


def _parse_single_statement(sql: str, dialect: str) -> exp.Expression:
    try:
        statements = [statement for statement in sqlglot.parse(sql, read=dialect) if statement is not None]
    except ParseError as exc:
        raise TranslationError(
            "The generated SQL could not be parsed and was discarded.",
            {"reason": str(exc)},
        ) from exc
    except SqlglotError as exc:  # pragma: no cover - defensive
        raise TranslationError("The generated SQL could not be analyzed and was discarded.") from exc

    if not statements:
        raise TranslationError("The model returned no executable SQL.")

    # Stacked statements are the classic way to smuggle a mutation past a
    # root-node check: `SELECT 1; DROP TABLE users`.
    if len(statements) > 1:
        raise SecurityViolationError(
            "Only a single SELECT statement is permitted; multiple statements were detected.",
            {"statement_count": len(statements)},
        )

    return statements[0]


def _assert_select_root(expression: exp.Expression) -> exp.Select:
    if isinstance(expression, exp.Select):
        return expression

    raise SecurityViolationError(
        "Only read-only SELECT queries are permitted. "
        f"The root operation was {expression.key.upper()}.",
        {"root_operation": expression.key.upper()},
    )


def _assert_no_forbidden_nodes(expression: exp.Expression) -> None:
    violations: list[str] = []

    for node in expression.walk():
        if isinstance(node, FORBIDDEN_NODES):
            violations.append(node.key.upper())
            continue

        if isinstance(node, exp.Func):
            # SQLGlot models well-known functions as dedicated classes and
            # everything else as `Anonymous`, which carries the raw callee
            # name in `.name` — `sql_name()` just returns "ANONYMOUS" there,
            # so both have to be consulted.
            candidates = {(node.sql_name() or "").upper()}
            if isinstance(node, exp.Anonymous):
                candidates.add(str(node.name).upper())

            for name in candidates & FORBIDDEN_FUNCTIONS:
                violations.append(f"{name}()")

    if violations:
        # Deduplicate while preserving discovery order so the dashboard
        # banner reads cleanly on a query with a repeated offender.
        unique = list(dict.fromkeys(violations))
        raise SecurityViolationError(
            "Query rejected: it contains data-mutating or unsafe operations — " + ", ".join(unique) + ".",
            {"violations": unique},
        )


def _collect_tables(expression: exp.Expression) -> list[str]:
    names: list[str] = []
    for table in expression.find_all(exp.Table):
        parts = [part.name for part in (table.args.get("catalog"), table.args.get("db"), table.this) if part]
        qualified = ".".join(part for part in parts if part)
        if qualified:
            names.append(qualified)
    return list(dict.fromkeys(names))


def _apply_row_cap(select: exp.Select, max_rows: int) -> tuple[exp.Select, int | None]:
    """
    Bound the result set. A question like "show me the orders" can otherwise
    return millions of rows straight into desktop memory. An existing,
    smaller LIMIT is respected; a larger one is clamped down.
    """
    if max_rows <= 0:
        return select, None

    limit = select.args.get("limit")
    if limit is None:
        return select.limit(max_rows), max_rows

    value = limit.expression
    if isinstance(value, exp.Literal) and value.is_int and int(value.name) > max_rows:
        return select.limit(max_rows), max_rows

    return select, None


def validate_sql(sql: str, dialect: str, max_rows: int = 0) -> GuardrailResult:
    """
    Validate a candidate query and return the sanitized form.

    The returned string is regenerated from the validated AST rather than
    echoed from the input, so what the client executes is exactly what was
    inspected — no trailing comment, hidden statement, or stray whitespace
    survives the round trip.

    Comments are stripped on the way out. That is not cosmetic: MySQL treats
    `/*!12345 ... */` as *executable* SQL rather than a comment, so anything
    the tree walk skipped over as an inert comment could otherwise still run
    on the target server.
    """
    read_dialect = _dialect_for(dialect)

    statement = _parse_single_statement(sql, read_dialect)
    select = _assert_select_root(statement)
    _assert_no_forbidden_nodes(select)

    tables = _collect_tables(select)
    capped, limit_applied = _apply_row_cap(select, max_rows)

    return GuardrailResult(
        sql=capped.sql(dialect=read_dialect, pretty=True, comments=False),
        tables=tables,
        limit_applied=limit_applied,
    )
