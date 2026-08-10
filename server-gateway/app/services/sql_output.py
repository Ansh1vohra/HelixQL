"""
Normalization of raw model output into a bare SQL string.

Shared by every provider engine: what has to be stripped off a model's reply
is a property of language models in general, not of any one vendor.
"""

import re

from app.errors import UnanswerableQuestionError
from app.services.prompts import UNANSWERABLE_SENTINEL

# Models are trained to be helpful, and "helpful" often means a ```sql
# fence even when told not to. Strip it rather than fail the request.
_FENCE_PATTERN = re.compile(r"^\s*```(?:sql|SQL)?\s*\n?(?P<body>.*?)\n?\s*```\s*$", re.DOTALL)


def strip_code_fences(text: str) -> str:
    match = _FENCE_PATTERN.match(text)
    return (match.group("body") if match else text).strip()


def parse_table_list(text: str, known: list[str]) -> list[str]:
    """
    Turn the schema linker's reply into a validated list of table names.

    Every returned name is matched back against `known` and anything else is
    dropped. That check is not defensive politeness — it is the only thing
    standing between a hallucinated table name and a schema blueprint built
    around a table that does not exist. Matching is case-insensitive but the
    catalog's own spelling is what comes back, so the caller can look each
    name up directly.

    Order follows the catalog rather than the model's reply, so the same
    selection always produces the same blueprint.
    """
    body = strip_code_fences(text)
    if body.strip().upper() == "NONE":
        return []

    # Models occasionally answer with a bulleted or newline-separated list
    # despite the one-line instruction; treat both separators as equivalent.
    candidates = {
        part.strip().strip("`\"'").lstrip("-*0123456789. ").strip().lower()
        for chunk in body.replace("\n", ",").split(",")
        for part in [chunk]
        if part.strip()
    }

    return [name for name in known if name.lower() in candidates]


def clean_sql(text: str) -> str:
    sql = strip_code_fences(text)
    if sql.startswith(UNANSWERABLE_SENTINEL):
        reason = sql[len(UNANSWERABLE_SENTINEL) :].strip()
        raise UnanswerableQuestionError(
            reason or "The connected schema does not contain the tables needed to answer this question."
        )
    # A trailing semicolon would make SQLGlot see a second (empty)
    # statement, and the client appends EXPLAIN by prefixing, so it has to
    # go regardless.
    return sql.rstrip().rstrip(";").strip()
