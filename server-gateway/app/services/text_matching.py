"""
Case-insensitive matching for text filters in generated SQL.

People type values the way they say them — "gujarat", "delivered", "blue
dart" — and databases store them however the application wrote them:
"Gujarat", "DELIVERED", "Blue Dart". The model has no way to close that gap.
It never sees a row, so it cannot know how a value is capitalized, and a
self-heal retry does not help either: a query that returns zero rows is not
an error, so there is nothing to repair.

So the gap is closed deterministically instead. After the model answers,
every comparison between a text column and a string literal is rewritten to
compare lowercased on both sides:

    u.state = 'gujarat'   →   LOWER(u.state) = 'gujarat'

Only where it is both needed and safe:

- **Text columns only**, judged from the blueprint's own types. Applying
  LOWER() to a date or an enum would break the query on PostgreSQL, and a
  column this module cannot resolve to a known table is left alone.
- **PostgreSQL always; MySQL only for case-sensitive collations.** MySQL's
  default collations already ignore case, and wrapping an indexed column in
  LOWER() stops the index being used. The desktop client marks a column's
  collation in its type only when it is *not* case-insensitive, so the
  default case costs nothing.

The index trade-off is real on PostgreSQL: `LOWER(col) = '...'` cannot use a
plain index on `col`. An expression index on `lower(col)` restores it. For
an interactive analytics tool, returning the right rows beats returning
none quickly.

This runs only on model output. SQL an operator typed into the manual editor
is executed as written, because they chose their own comparison.
"""

import re

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError

from app.services.guardrail import SQLGLOT_DIALECTS

_CREATE_TABLE = re.compile(r"CREATE\s+TABLE\s+(?P<name>[^\s(]+)\s*\((?P<body>.*)\)", re.IGNORECASE | re.DOTALL)
_COLUMN_LINE = re.compile(r"^\s*(?P<name>[^\s,]+)\s+(?P<type>[^,]+?),?\s*$")

# Types that hold free text. Deliberately a prefix match on the type as the
# client renders it (`VARCHAR(80)`, `CHARACTER VARYING(80)`, `TEXT`), and
# deliberately narrow: PostgreSQL enums arrive as `USER-DEFINED`, and LOWER()
# on one of those is an error, not a no-op.
_TEXT_TYPE = re.compile(r"^(?:N?VARCHAR|N?CHAR|CHARACTER|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|CITEXT|ENUM)\b", re.IGNORECASE)
_COLLATION = re.compile(r"\bCOLLATE\s+(?P<name>\S+)", re.IGNORECASE)

# Lines inside CREATE TABLE that declare constraints rather than columns.
_CONSTRAINT_PREFIXES = ("PRIMARY ", "FOREIGN ", "UNIQUE ", "CONSTRAINT ", "KEY ", "INDEX ", "CHECK ")

Schema = dict[str, dict[str, bool]]


def _needs_folding(column_type: str, dialect: str) -> bool:
    if not _TEXT_TYPE.match(column_type.strip()):
        return False
    if dialect == "postgres":
        return True
    collation = _COLLATION.search(column_type)
    return bool(collation) and not collation.group("name").lower().endswith("_ci")


def parse_blueprint(schema_ddl: list[str], dialect: str) -> Schema:
    """
    Map table → column → whether comparisons on it should ignore case.

    Parsed with a line regex rather than SQLGlot, because the blueprint's
    types come verbatim from each database's catalog (`CHARACTER VARYING`,
    `USER-DEFINED`, `ENUM('a','b')`) and a type SQLGlot cannot parse must not
    cost the whole table its metadata.
    """
    schema: Schema = {}
    for statement in schema_ddl:
        match = _CREATE_TABLE.search(statement)
        if not match:
            continue
        columns: dict[str, bool] = {}
        for line in match.group("body").splitlines():
            if not line.strip() or line.strip().upper().startswith(_CONSTRAINT_PREFIXES):
                continue
            column = _COLUMN_LINE.match(line)
            if column:
                columns[column.group("name").strip('`"').lower()] = _needs_folding(column.group("type"), dialect)
        schema[match.group("name").strip('`"').lower()] = columns
    return schema


def _table_aliases(tree: exp.Expression) -> dict[str, str | None]:
    """
    Alias (or bare name) → table name, for every table reference in the tree.

    An alias bound to two different tables in different scopes maps to None:
    resolving it would be a guess, and a wrong guess applies LOWER() to a
    column that may not be text.
    """
    aliases: dict[str, str | None] = {}
    for table in tree.find_all(exp.Table):
        name = table.name.lower()
        key = (table.alias or table.name).lower()
        if key in aliases and aliases[key] != name:
            aliases[key] = None
        else:
            aliases[key] = name
    return aliases


def _foldable(column: exp.Column, aliases: dict[str, str | None], schema: Schema) -> str | None:
    """Returns `table.column` when the column resolves to a text column that
    needs folding, else None."""
    name = column.name.lower()
    if column.table:
        table = aliases.get(column.table.lower())
        return f"{table}.{name}" if table and schema.get(table, {}).get(name) else None

    # Unqualified: every table in the query that has this column must agree,
    # otherwise the database would call it ambiguous or it names something
    # other than a base column (a CTE output, a select alias).
    owners = sorted({t for t in aliases.values() if t and name in schema.get(t, {})})
    if owners and all(schema[t][name] for t in owners):
        return f"{owners[0]}.{name}"
    return None


def _is_text_literal(node: exp.Expression | None) -> bool:
    return isinstance(node, exp.Literal) and node.is_string


def _lowered(literal: exp.Literal) -> exp.Expression:
    # Lowercased here when that is unambiguous, which keeps the SQL readable.
    # Outside ASCII, Python and the database can disagree on case mapping,
    # so the database's own LOWER() decides.
    value = literal.name
    return exp.Literal.string(value.lower()) if value.isascii() else exp.Lower(this=literal.copy())


def fold_text_comparisons(sql: str, dialect: str, schema_ddl: list[str]) -> tuple[str, list[str]]:
    """
    Rewrite text comparisons in `sql` to ignore case.

    Returns the SQL and the `table.column` names that were folded, so the
    client can say so. Anything this cannot parse cleanly is returned
    unchanged: the guardrail runs next and is what reports bad SQL.
    """
    schema = parse_blueprint(schema_ddl, dialect)
    if not any(any(columns.values()) for columns in schema.values()):
        return sql, []

    read = SQLGLOT_DIALECTS.get(dialect, dialect)
    try:
        statements = [s for s in sqlglot.parse(sql, read=read) if s is not None]
    except (SqlglotError, ValueError):
        return sql, []
    # More than one statement is the guardrail's to reject. Rewriting only the
    # first would silently drop the rest from what the guardrail inspects.
    if len(statements) != 1:
        return sql, []

    tree = statements[0]
    aliases = _table_aliases(tree)
    folded: list[str] = []

    def fold(column: exp.Expression) -> bool:
        if not isinstance(column, exp.Column):
            return False
        resolved = _foldable(column, aliases, schema)
        if resolved:
            column.replace(exp.Lower(this=column.copy()))
            folded.append(resolved)
        return bool(resolved)

    for node in list(tree.find_all(exp.EQ, exp.NEQ, exp.Like, exp.In)):
        if isinstance(node, exp.In):
            values = node.expressions
            if values and all(_is_text_literal(v) for v in values) and fold(node.this):
                node.set("expressions", [_lowered(v) for v in values])
            continue

        left, right = node.this, node.expression
        if _is_text_literal(right) and fold(left):
            right.replace(_lowered(right))
        elif _is_text_literal(left) and fold(right):
            left.replace(_lowered(left))

    if not folded:
        return sql, []
    return tree.sql(dialect=read), list(dict.fromkeys(folded))
