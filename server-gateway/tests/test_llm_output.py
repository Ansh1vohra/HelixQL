import pytest

from app.errors import UnanswerableQuestionError
from app.services.llm import _clean_sql

# Real-world shapes Gemini returns despite the output contract in the system
# instruction. Each one has to end up as bare, parseable SQL.
FENCED_OUTPUTS = [
    ("```sql\nSELECT 1\n```", "SELECT 1"),
    ("```SQL\nSELECT 1\n```", "SELECT 1"),
    ("```\nSELECT 1\n```", "SELECT 1"),
    ("  SELECT 1  ", "SELECT 1"),
    ("SELECT 1;", "SELECT 1"),
    ("```sql\nSELECT 1;\n```", "SELECT 1"),
]


@pytest.mark.parametrize("raw,expected", FENCED_OUTPUTS)
def test_normalizes_model_output(raw: str, expected: str) -> None:
    assert _clean_sql(raw) == expected


def test_preserves_internal_semicolons_in_string_literals() -> None:
    sql = "SELECT * FROM t WHERE note = 'a;b'"
    assert _clean_sql(sql) == sql


def test_multiline_sql_survives_intact() -> None:
    raw = "```sql\nSELECT a,\n       b\nFROM t\n```"
    assert _clean_sql(raw) == "SELECT a,\n       b\nFROM t"


def test_unanswerable_sentinel_raises_with_the_reason() -> None:
    with pytest.raises(UnanswerableQuestionError, match="no orders table"):
        _clean_sql("HELIXQL_UNANSWERABLE: no orders table in the blueprint")


def test_unanswerable_sentinel_inside_a_fence_is_still_caught() -> None:
    with pytest.raises(UnanswerableQuestionError):
        _clean_sql("```\nHELIXQL_UNANSWERABLE: nothing to query\n```")


def test_unanswerable_without_a_reason_falls_back_to_a_readable_message() -> None:
    with pytest.raises(UnanswerableQuestionError, match="does not contain the tables"):
        _clean_sql("HELIXQL_UNANSWERABLE:")
