import json

import pytest

from app.services.prompts import WRITE_PLANNER_SYSTEM_INSTRUCTION, build_write_plan_prompt
from app.services.write_plan_output import parse_write_plan

SCHEMA = ["CREATE TABLE customers (\n  id INT NOT NULL GENERATED,\n  email VARCHAR(100) NOT NULL\n);"]


# --- Parsing ----------------------------------------------------------------


def test_parses_a_read():
    assert parse_write_plan('{"status": "read"}', False).status == "read"


def test_parses_an_insert_plan():
    reply = parse_write_plan(
        json.dumps({"status": "ready", "plan": {"operation": "insert", "table": "customers", "values": {"email": "a@b.c"}}}),
        False,
    )
    assert reply.status == "ready"
    assert reply.plan is not None
    assert reply.plan.values == {"email": "a@b.c"}


def test_parses_an_update_with_conditions():
    reply = parse_write_plan(
        json.dumps(
            {
                "status": "ready",
                "plan": {
                    "operation": "update",
                    "table": "customers",
                    "values": {"email": "new@b.c"},
                    "where": [{"column": "id", "op": "=", "value": 7}],
                },
            }
        ),
        False,
    )
    assert reply.plan is not None
    assert reply.plan.where[0].value == 7


@pytest.mark.parametrize("operation", ["update", "delete"])
def test_a_write_without_a_condition_becomes_a_question(operation):
    reply = parse_write_plan(
        json.dumps({"status": "ready", "plan": {"operation": operation, "table": "customers", "values": {"email": "x"}}}),
        False,
    )
    assert reply.status == "ask"
    assert reply.plan is None


def test_an_unknown_operator_is_not_trusted():
    reply = parse_write_plan(
        json.dumps(
            {
                "status": "ready",
                "plan": {
                    "operation": "delete",
                    "table": "customers",
                    "where": [{"column": "id", "op": "OR 1=1 --", "value": 1}],
                },
            }
        ),
        False,
    )
    assert reply.status == "ask"
    assert reply.plan is None


def test_unreadable_output_asks_to_rephrase_rather_than_guessing():
    reply = parse_write_plan("DELETE FROM customers", False)
    assert reply.status == "ask"
    assert reply.plan is None


def test_a_spent_budget_stops_asking():
    assert parse_write_plan('{"status": "ask", "question": "More?"}', True).status == "unanswerable"


# --- Prompt -----------------------------------------------------------------


def test_prompt_carries_schema_today_and_conversation():
    prompt = build_write_plan_prompt("add a customer", SCHEMA, [("assistant", "Email?"), ("user", "a@b.c")], "2026-10-12", 1, 8)
    assert "GENERATED" in prompt
    assert "TODAY: 2026-10-12" in prompt
    assert "USER: a@b.c" in prompt
    assert "asked 1 of 8" in prompt


def test_the_planner_is_told_never_to_invent_values_or_write_sql():
    assert "never" in WRITE_PLANNER_SYSTEM_INSTRUCTION.lower() and "invent" in WRITE_PLANNER_SYSTEM_INSTRUCTION
    assert "You never write SQL" in WRITE_PLANNER_SYSTEM_INSTRUCTION


# --- Route ------------------------------------------------------------------


def _payload(**overrides):
    payload = {"question": "add a customer with email a@b.c", "schema_ddl": SCHEMA, "history": []}
    payload.update(overrides)
    return payload


def test_the_route_returns_a_plan(client, fake_llm):
    fake_llm.write_responses = [
        json.dumps({"status": "ready", "plan": {"operation": "insert", "table": "customers", "values": {"email": "a@b.c"}}})
    ]
    response = client.post("/v1/beta/write-plan", json=_payload())

    assert response.status_code == 200
    assert response.json()["plan"]["operation"] == "insert"


def test_the_opening_write_turn_is_metered_once(client, fake_llm, fake_control_plane):
    fake_llm.write_responses = ['{"status": "ask", "question": "Which email?"}', '{"status": "ask", "question": "Name?"}']

    client.post("/v1/beta/write-plan", json=_payload())
    history = [{"role": "assistant", "content": "Which email?"}, {"role": "user", "content": "a@b.c"}]
    client.post("/v1/beta/write-plan", json=_payload(history=history))

    assert len(fake_control_plane.increment_calls) == 1


def test_a_read_is_not_metered_here(client, fake_llm, fake_control_plane):
    fake_llm.write_responses = ['{"status": "read"}']
    response = client.post("/v1/beta/write-plan", json=_payload(question="how many customers"))

    assert response.json()["status"] == "read"
    assert fake_control_plane.increment_calls == []


def test_the_route_requires_authentication(unauthenticated_client):
    assert unauthenticated_client.post("/v1/beta/write-plan", json=_payload()).status_code == 401


def test_prompt_lists_earlier_requests():
    context = [("add customer Asha", "Add a row to customers: email = a@b.c.")]
    prompt = build_write_plan_prompt("now change her email", SCHEMA, [], "2026-10-12", 0, 8, context)
    assert "EARLIER REQUESTS" in prompt
    assert "Done: Add a row to customers" in prompt


def test_the_route_passes_earlier_requests(client, fake_llm):
    context = [{"question": "add Asha", "resolved_question": "Add a row to customers: email = a@b.c."}]
    client.post("/v1/beta/write-plan", json=_payload(context=context))
    assert fake_llm.write_calls[0]["context"] == [("add Asha", "Add a row to customers: email = a@b.c.")]


def test_tolerates_trailing_junk_after_the_object():
    """qwen2.5:3b, observed: a complete plan followed by a stray `[]}`."""
    raw = '{"status": "ready", "plan": {"operation": "delete", "table": "customers", "where": [{"column": "id", "op": "=", "value": 42}]}[]}'
    reply = parse_write_plan(raw, False)
    assert reply.status == "ready"
    assert reply.plan is not None
    assert reply.plan.where[0].value == 42
