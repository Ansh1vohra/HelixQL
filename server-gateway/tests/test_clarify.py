import json

import httpx
import pytest

from app.config import Settings
from app.services.clarify_output import fallback_question, parse_clarification
from app.services.groq import GroqSynthesisEngine
from app.services.llm import GeminiSynthesisEngine
from app.services.prompts import build_clarify_prompt

SCHEMA = [
    "CREATE TABLE customers (id INT PRIMARY KEY, name VARCHAR(100));",
    "CREATE TABLE orders (id INT PRIMARY KEY, customer_id INT, total DECIMAL(10,2));",
]


def settings(**overrides) -> Settings:
    return Settings(control_plane_internal_secret="test-secret", **overrides)  # type: ignore[arg-type]


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


def test_parses_a_clarifying_question():
    reply = '{"status": "ask", "question": "Best by what?", "options": ["Most orders", "Highest spend"]}'
    result = parse_clarification(reply, "best customer", [], budget_spent=False)

    assert result.status == "ask"
    assert result.message == "Best by what?"
    assert result.options == ["Most orders", "Highest spend"]


def test_parses_a_ready_reply_with_assumptions():
    reply = '{"status": "ready", "resolved_question": "Top 10 customers by total spend", "assumptions": ["All time"]}'
    result = parse_clarification(reply, "best customer", [], budget_spent=False)

    assert result.status == "ready"
    assert result.resolved_question == "Top 10 customers by total spend"
    assert result.assumptions == ["All time"]


def test_parses_an_unanswerable_reply():
    reply = '{"status": "unanswerable", "reason": "There is no ratings data."}'
    result = parse_clarification(reply, "happiest customer", [], budget_spent=False)

    assert result.status == "unanswerable"
    assert result.message == "There is no ratings data."


def test_tolerates_fences_and_leading_prose():
    reply = 'Sure, here it is:\n```json\n{"status": "ask", "question": "Which metric?", "options": []}\n```'
    assert parse_clarification(reply, "q", [], budget_spent=False).status == "ask"


def test_an_unreadable_reply_proceeds_with_what_the_user_said():
    history = [("assistant", "Best by what?"), ("user", "highest spend")]
    result = parse_clarification("I think you mean spend.", "best customer", history, budget_spent=False)

    assert result.status == "ready"
    assert result.resolved_question == "best customer (highest spend)"


def test_a_spent_budget_turns_another_question_into_ready():
    history = [("assistant", "Q1"), ("user", "A1")]
    reply = '{"status": "ask", "question": "One more thing?", "options": ["x"]}'

    result = parse_clarification(reply, "best customer", history, budget_spent=True)

    assert result.status == "ready"
    assert result.resolved_question == "best customer (A1)"


def test_options_are_capped_and_non_strings_dropped():
    reply = json.dumps({"status": "ask", "question": "Q?", "options": ["a", 2, "", "b", "c", "d", "e"]})
    assert parse_clarification(reply, "q", [], budget_spent=False).options == ["a", "b", "c", "d"]


def test_an_ask_without_a_question_is_not_shown_to_the_user():
    reply = '{"status": "ask", "question": "", "options": ["a"]}'
    assert parse_clarification(reply, "q", [], budget_spent=False).status == "ready"


def test_fallback_question_without_answers_is_the_original():
    assert fallback_question("  best customer ", []) == "best customer"


# --- Prompt -----------------------------------------------------------------


def test_prompt_carries_schema_conversation_and_budget():
    prompt = build_clarify_prompt("best customer", SCHEMA, [("assistant", "By what?"), ("user", "spend")], 1, 3)

    assert "CREATE TABLE orders" in prompt
    assert "ANALYST: By what?" in prompt
    assert "USER: spend" in prompt
    assert "asked 1 of 3" in prompt


def test_prompt_demands_a_decision_once_the_budget_is_spent():
    prompt = build_clarify_prompt("q", SCHEMA, [("assistant", "Q"), ("user", "A")], 1, 1)
    assert "budget is spent" in prompt


# --- Engine behaviour -----------------------------------------------------


async def test_clarifies_through_the_provider():
    engine, seen = engine_returning('{"status": "ask", "question": "Best by what?", "options": ["Orders", "Spend"]}')

    result = await engine.clarify("best customer", SCHEMA, [], max_turns=3)

    assert result.status == "ask"
    payload = json.loads(seen[0].content)
    assert "clarifying analyst" in payload["messages"][0]["content"]
    assert "CREATE TABLE orders" in payload["messages"][1]["content"]


async def test_the_engine_enforces_the_turn_budget():
    engine, _ = engine_returning('{"status": "ask", "question": "Again?", "options": []}')
    history = [("assistant", "Q1"), ("user", "A1"), ("assistant", "Q2"), ("user", "A2")]

    result = await engine.clarify("best customer", SCHEMA, history, max_turns=2)

    assert result.status == "ready"


def test_both_engines_expose_the_clarifier():
    assert callable(GroqSynthesisEngine.clarify)
    assert callable(GeminiSynthesisEngine.clarify)


# --- Route behaviour ------------------------------------------------------


def _payload(**overrides):
    payload = {"question": "Who is our best customer?", "schema_ddl": SCHEMA, "history": []}
    payload.update(overrides)
    return payload


def test_the_route_returns_a_question(client, fake_llm):
    fake_llm.clarify_responses = ['{"status": "ask", "question": "Best by what?", "options": ["Orders", "Spend"]}']

    response = client.post("/v1/clarify", json=_payload())

    assert response.status_code == 200
    assert response.json()["status"] == "ask"
    assert response.json()["options"] == ["Orders", "Spend"]


def test_the_route_passes_history_and_the_configured_budget(client, fake_llm, settings):
    history = [{"role": "assistant", "content": "Best by what?"}, {"role": "user", "content": "Spend"}]
    client.post("/v1/clarify", json=_payload(history=history))

    call = fake_llm.clarify_calls[0]
    assert call["history"] == [("assistant", "Best by what?"), ("user", "Spend")]
    assert call["max_turns"] == settings.max_clarify_turns


def test_clarifying_does_not_consume_the_users_query_allowance(client, fake_control_plane):
    client.post("/v1/clarify", json=_payload())
    assert fake_control_plane.increment_calls == []


def test_the_route_requires_authentication(unauthenticated_client):
    assert unauthenticated_client.post("/v1/clarify", json=_payload()).status_code == 401


@pytest.mark.parametrize("role", ["system", "tool"])
def test_the_route_rejects_unknown_roles(client, role):
    response = client.post("/v1/clarify", json=_payload(history=[{"role": role, "content": "x"}]))
    assert response.status_code in (400, 422)


def test_the_route_rejects_an_oversized_history(client):
    history = [{"role": "user", "content": "x"}] * 13
    assert client.post("/v1/clarify", json=_payload(history=history)).status_code in (400, 422)
