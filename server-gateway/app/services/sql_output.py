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
