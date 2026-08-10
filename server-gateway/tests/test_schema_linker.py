import json

import httpx
import pytest

from app.config import Settings
from app.services.groq import GroqSynthesisEngine
from app.services.llm import GeminiSynthesisEngine
from app.services.sql_output import parse_table_list

BASE = {"control_plane_internal_secret": "test-secret"}
KNOWN = ["signup", "ai_user_events", "invoices", "orders"]
CATALOG = [
    "signup(id, email, password_hash, full_name)",
    "ai_user_events(id, event_name, payload)",
    "invoices(id, amount)",
    "orders(id, user_id, total)",
]


def settings(**overrides) -> Settings:
    return Settings(**BASE, **overrides)  # type: ignore[arg-type]


def engine_returning(content: str) -> tuple[GroqSynthesisEngine, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={"choices": [{"index": 0, "finish_reason": "stop", "message": {"content": content}}]},
        )

    config = settings(llm_provider="groq", groq_api_key="gsk_test")
    return GroqSynthesisEngine(config, httpx.AsyncClient(transport=httpx.MockTransport(handler))), seen


# --- Output parsing -------------------------------------------------------


def test_parses_a_comma_separated_list():
    assert parse_table_list("signup, orders", KNOWN) == ["signup", "orders"]


def test_drops_a_hallucinated_table_name():
    """The one check standing between an invented name and a blueprint built
    around a table that does not exist."""
    assert parse_table_list("signup, users, customers", KNOWN) == ["signup"]


def test_matches_case_insensitively_but_returns_the_catalog_spelling():
    """The name is used as a lookup key downstream, so the catalog's own
    spelling has to survive the round trip."""
    assert parse_table_list("SIGNUP, Orders", KNOWN) == ["signup", "orders"]


def test_accepts_a_newline_or_bulleted_list():
    """Models drift to bullets despite the one-line instruction, and the
    selection is still perfectly readable."""
    assert parse_table_list("- signup\n- orders", KNOWN) == ["signup", "orders"]
    assert parse_table_list("1. signup\n2. invoices", KNOWN) == ["signup", "invoices"]


def test_strips_quoting_and_fences():
    assert parse_table_list("```\n`signup`, \"orders\"\n```", KNOWN) == ["signup", "orders"]


def test_reads_none_as_an_empty_selection():
    assert parse_table_list("NONE", KNOWN) == []
    assert parse_table_list("none", KNOWN) == []


def test_returns_catalog_order_not_reply_order():
    """Determinism: the same selection must always build the same blueprint,
    however the model happened to order its reply."""
    assert parse_table_list("orders, signup", KNOWN) == parse_table_list("signup, orders", KNOWN)


def test_an_unusable_reply_selects_nothing_rather_than_guessing():
    assert parse_table_list("I'm not sure which tables you mean!", KNOWN) == []
    assert parse_table_list("", KNOWN) == []


# --- Engine behaviour -----------------------------------------------------


async def test_links_a_schema_through_the_provider():
    engine, seen = engine_returning("signup")

    assert await engine.link_schema("how many users do we have", CATALOG, KNOWN) == ["signup"]

    payload = json.loads(seen[0].content)
    assert payload["temperature"] == 0.0
    assert "schema linker" in payload["messages"][0]["content"].lower()
    assert "signup(id, email, password_hash, full_name)" in payload["messages"][1]["content"]


async def test_the_catalog_carries_no_types_or_row_data():
    engine, seen = engine_returning("signup")
    await engine.link_schema("q", CATALOG, KNOWN)

    prompt = json.loads(seen[0].content)["messages"][1]["content"]
    assert "VARCHAR" not in prompt.upper()
    assert "CREATE TABLE" not in prompt.upper()


async def test_a_hallucinated_name_never_escapes_the_engine():
    engine, _ = engine_returning("signup, nonexistent_table")
    assert await engine.link_schema("q", CATALOG, KNOWN) == ["signup"]


def test_both_engines_expose_the_linker():
    """The route depends on this; drift would only show up in production."""
    assert callable(GroqSynthesisEngine.link_schema)
    assert callable(GeminiSynthesisEngine.link_schema)


# --- Route behaviour ------------------------------------------------------


def test_the_route_returns_the_selection(client, fake_llm):
    fake_llm.link_responses = [["signup"]]

    response = client.post("/v1/link-schema", json={"question": "how many users", "catalog": CATALOG})

    assert response.status_code == 200
    assert response.json() == {"tables": ["signup"]}


def test_the_route_recovers_table_names_from_the_catalog(client, fake_llm):
    """`known` is what the model's reply is validated against — if the route
    derives it wrongly, the hallucination filter silently stops working."""
    client.post("/v1/link-schema", json={"question": "q", "catalog": CATALOG})

    assert fake_llm.link_calls[0]["known"] == KNOWN


def test_linking_does_not_consume_the_users_query_allowance(client, fake_control_plane):
    client.post("/v1/link-schema", json={"question": "q", "catalog": CATALOG})
    assert fake_control_plane.increment_calls == []


def test_the_route_requires_authentication(unauthenticated_client):
    response = unauthenticated_client.post("/v1/link-schema", json={"question": "q", "catalog": CATALOG})
    assert response.status_code == 401


def test_the_route_rejects_an_empty_catalog(client):
    assert client.post("/v1/link-schema", json={"question": "q", "catalog": []}).status_code == 400


@pytest.mark.parametrize("question", ["", " " * 3])
def test_the_route_rejects_a_blank_question(client, question):
    response = client.post("/v1/link-schema", json={"question": question, "catalog": CATALOG})
    assert response.status_code in (400, 422)
