import pytest

from app.services.guardrail import validate_sql
from app.services.text_matching import fold_text_comparisons, parse_blueprint

# Shaped exactly like the desktop client's blueprint: one column per line,
# types verbatim from each database's catalog.
POSTGRES_SCHEMA = [
    """CREATE TABLE customers (
  id INTEGER NOT NULL,
  first_name CHARACTER VARYING(80) NOT NULL,
  state CHARACTER VARYING(80),
  signed_up_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  mood USER-DEFINED,
  PRIMARY KEY (id)
);""",
    """CREATE TABLE orders (
  id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  status CHARACTER VARYING(20) NOT NULL,
  ordered_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);""",
]


def fold(sql: str, dialect: str = "postgres", schema: list[str] = POSTGRES_SCHEMA) -> tuple[str, list[str]]:
    return fold_text_comparisons(sql, dialect, schema)


def test_folds_an_equality_filter_on_a_text_column() -> None:
    sql, columns = fold("SELECT COUNT(*) FROM customers WHERE state = 'Gujarat'")
    assert "LOWER(state) = 'gujarat'" in sql
    assert columns == ["customers.state"]


def test_resolves_aliases_across_a_join() -> None:
    sql, columns = fold(
        "SELECT c.first_name FROM customers c JOIN orders o ON o.customer_id = c.id "
        "WHERE c.state = 'gujarat' AND o.status IN ('Delivered', 'SHIPPED')"
    )
    assert "LOWER(c.state) = 'gujarat'" in sql
    assert "LOWER(o.status) IN ('delivered', 'shipped')" in sql
    # The join condition compares two columns and is untouched.
    assert "o.customer_id = c.id" in sql
    assert columns == ["customers.state", "orders.status"]


@pytest.mark.parametrize(
    "condition,expected",
    [
        ("state <> 'Gujarat'", "LOWER(state) <> 'gujarat'"),
        ("state LIKE '%Guj%'", "LOWER(state) LIKE '%guj%'"),
        ("'Gujarat' = state", "'gujarat' = LOWER(state)"),
    ],
)
def test_folds_other_comparison_shapes(condition: str, expected: str) -> None:
    sql, _ = fold(f"SELECT id FROM customers WHERE {condition}")
    assert expected in sql


@pytest.mark.parametrize(
    "sql",
    [
        # Not a text column: LOWER() on a timestamp is an error in PostgreSQL.
        "SELECT id FROM orders WHERE ordered_at >= '2026-01-01' AND ordered_at = '2026-01-01'",
        # PostgreSQL enums arrive as USER-DEFINED; LOWER() on one fails.
        "SELECT id FROM customers WHERE mood = 'Happy'",
        # A CTE output column is not a base column this can vouch for.
        "WITH s AS (SELECT state AS st FROM customers) SELECT * FROM s WHERE st = 'Gujarat'",
        # Already case-insensitive as the model wrote it.
        "SELECT id FROM customers WHERE LOWER(state) = 'gujarat'",
        # Unknown qualifier.
        "SELECT id FROM customers WHERE x.state = 'Gujarat'",
    ],
)
def test_leaves_comparisons_it_cannot_vouch_for(sql: str) -> None:
    assert fold(sql) == (sql, [])


def test_mysql_default_collations_are_left_alone() -> None:
    schema = ["CREATE TABLE customers (\n  id INT NOT NULL,\n  state VARCHAR(80)\n);"]
    sql = "SELECT id FROM customers WHERE state = 'Gujarat'"
    assert fold(sql, "mysql", schema) == (sql, [])


def test_mysql_case_sensitive_collations_are_folded() -> None:
    schema = ["CREATE TABLE customers (\n  id INT NOT NULL,\n  state VARCHAR(80) COLLATE UTF8MB4_BIN\n);"]
    sql, columns = fold("SELECT id FROM customers WHERE state = 'Gujarat'", "mysql", schema)
    assert "LOWER(state) = 'gujarat'" in sql
    assert columns == ["customers.state"]


def test_stacked_statements_are_left_for_the_guardrail() -> None:
    # Rewriting only the first statement would hide the second from the
    # guardrail, which must still see it and refuse.
    sql = "SELECT id FROM customers WHERE state = 'Gujarat'; DROP TABLE customers"
    assert fold(sql) == (sql, [])


def test_folded_sql_still_passes_the_guardrail() -> None:
    sql, _ = fold("SELECT COUNT(*) FROM customers WHERE state = 'Gujarat'")
    assert validate_sql(sql, "postgres").sql


def test_parse_blueprint_skips_constraint_lines() -> None:
    schema = parse_blueprint(POSTGRES_SCHEMA, "postgres")
    assert schema["orders"] == {"id": False, "customer_id": False, "status": True, "ordered_at": False}
