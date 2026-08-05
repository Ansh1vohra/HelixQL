import pytest

from app.errors import SecurityViolationError, TranslationError
from app.services.guardrail import validate_sql

# Every one of these must be refused. They are the attack surface the
# guardrail exists for: a compromised prompt, a jailbroken model, or a
# hand-edited query all arrive here as an ordinary string.
BLOCKED_QUERIES = [
    ("DROP TABLE users", "mysql"),
    ("DELETE FROM orders WHERE 1=1", "mysql"),
    ("UPDATE users SET role = 'admin'", "mysql"),
    ("INSERT INTO users (name) VALUES ('x')", "mysql"),
    ("TRUNCATE TABLE orders", "mysql"),
    ("ALTER TABLE users ADD COLUMN x INT", "mysql"),
    ("CREATE TABLE t (id INT)", "mysql"),
    ("GRANT ALL ON *.* TO 'x'@'%'", "mysql"),
    # Stacked statements — a SELECT root does not make the payload safe.
    ("SELECT 1; DROP TABLE users", "mysql"),
    ("SELECT * FROM users; DELETE FROM users", "postgres"),
    # Mutations buried inside an otherwise read-shaped query.
    ("WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d", "postgres"),
    ("SELECT * FROM users WHERE id IN (SELECT id FROM (SELECT 1) t) AND sleep(5)", "mysql"),
    # Filesystem and command execution dressed as a SELECT.
    ("SELECT LOAD_FILE('/etc/passwd')", "mysql"),
    ("SELECT pg_read_file('/etc/passwd')", "postgres"),
    ("SELECT * INTO exfil FROM users", "postgres"),
    # Denial of service.
    ("SELECT pg_sleep(30)", "postgres"),
    ("SELECT BENCHMARK(100000000, MD5('x'))", "mysql"),
    # Sequence mutation — a write that looks like a read.
    ("SELECT nextval('user_id_seq')", "postgres"),
    # Row locks block other writers, so they are not read-only in practice.
    ("SELECT * FROM users FOR UPDATE", "postgres"),
    # Session/transaction control.
    ("SET GLOBAL general_log = 'ON'", "mysql"),
    ("USE mysql", "mysql"),
]


@pytest.mark.parametrize("sql,dialect", BLOCKED_QUERIES)
def test_rejects_unsafe_queries(sql: str, dialect: str) -> None:
    with pytest.raises((SecurityViolationError, TranslationError)):
        validate_sql(sql, dialect)


ALLOWED_QUERIES = [
    ("SELECT id, name FROM users", "mysql"),
    ("SELECT u.name, COUNT(o.id) AS c FROM users u JOIN orders o ON o.user_id = u.id GROUP BY u.name", "mysql"),
    ("SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)", "postgres"),
    ("WITH recent AS (SELECT * FROM orders WHERE total > 10) SELECT COUNT(*) FROM recent", "postgres"),
    ("SELECT * FROM (SELECT a FROM t1 UNION SELECT a FROM t2) AS combined", "mysql"),
]


@pytest.mark.parametrize("sql,dialect", ALLOWED_QUERIES)
def test_allows_read_only_queries(sql: str, dialect: str) -> None:
    result = validate_sql(sql, dialect)
    assert result.sql.strip().upper().startswith(("SELECT", "WITH"))


def test_top_level_set_operations_are_rejected() -> None:
    """The spec requires a SELECT root node. A bare UNION is not one — the
    translator prompt tells the model to wrap it in a subquery instead."""
    with pytest.raises(SecurityViolationError) as exc:
        validate_sql("SELECT a FROM t1 UNION SELECT b FROM t2", "mysql")
    assert exc.value.details["root_operation"] == "UNION"


def test_reports_which_node_triggered_the_violation() -> None:
    with pytest.raises(SecurityViolationError) as exc:
        validate_sql("WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d", "postgres")
    assert "DELETE" in exc.value.details["violations"]


def test_unparseable_sql_is_a_translation_failure_not_a_security_violation() -> None:
    with pytest.raises(TranslationError):
        validate_sql("this is not sql at all", "mysql")


def test_strips_comments_so_mysql_executable_comments_cannot_survive() -> None:
    """MySQL runs `/*! ... */` as real SQL. Regenerating without comments is
    what stops a payload hidden there from reaching the database."""
    result = validate_sql("SELECT /*!32302 1 */ id FROM users -- ; DROP TABLE t", "mysql")
    assert "/*" not in result.sql
    assert "DROP" not in result.sql.upper()


def test_collects_referenced_tables() -> None:
    result = validate_sql("SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id", "mysql")
    assert result.tables == ["users", "orders"]


def test_injects_row_cap_when_query_has_no_limit() -> None:
    result = validate_sql("SELECT * FROM users", "mysql", max_rows=500)
    assert result.limit_applied == 500
    assert "LIMIT 500" in result.sql


def test_respects_a_smaller_existing_limit() -> None:
    result = validate_sql("SELECT * FROM users LIMIT 10", "mysql", max_rows=500)
    assert result.limit_applied is None
    assert "LIMIT 10" in result.sql


def test_clamps_an_oversized_existing_limit() -> None:
    result = validate_sql("SELECT * FROM users LIMIT 999999", "mysql", max_rows=500)
    assert result.limit_applied == 500
    assert "LIMIT 500" in result.sql


def test_row_cap_is_skipped_when_disabled() -> None:
    result = validate_sql("SELECT * FROM users", "mysql", max_rows=0)
    assert result.limit_applied is None
    assert "LIMIT" not in result.sql.upper()
