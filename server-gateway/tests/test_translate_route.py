from app.errors import QueryLimitExceededError
from tests.conftest import TEST_SCHEMA


def _payload(**overrides):
    payload = {
        "question": "Who made the most orders from Gujarat this month?",
        "schema_ddl": TEST_SCHEMA,
        "dialect": "mysql",
    }
    payload.update(overrides)
    return payload


def test_translates_and_returns_sanitized_sql(client, fake_llm):
    fake_llm.responses = ["```sql\nSELECT name FROM users WHERE state = 'Gujarat';\n```"]

    response = client.post("/v1/translate", json=_payload())

    assert response.status_code == 200
    body = response.json()
    # Markdown fence and trailing semicolon are stripped, and the SQL comes
    # back regenerated from the validated AST.
    assert body["sql"].startswith("SELECT")
    assert "```" not in body["sql"]
    assert not body["sql"].rstrip().endswith(";")
    assert body["attempt"] == 1
    assert body["tables"] == ["users"]
    assert body["usage"] == {"remaining": 42, "monthly_query_limit": 100}


def test_meters_usage_before_calling_the_model(client, fake_control_plane):
    client.post("/v1/translate", json=_payload())
    assert fake_control_plane.increment_calls == ["user-1"]


def test_rejects_when_monthly_allowance_is_exhausted(client, fake_control_plane, fake_llm):
    fake_control_plane.increment_error = QueryLimitExceededError("Monthly query allowance exceeded for this plan.")

    response = client.post("/v1/translate", json=_payload())

    assert response.status_code == 429
    assert response.json()["code"] == "QUERY_LIMIT_EXCEEDED"
    # The paid pipeline must not run for a user who is over their cap.
    assert fake_llm.translate_calls == []


def test_blocks_destructive_sql_from_the_model(client, fake_llm):
    fake_llm.responses = ["DROP TABLE users"]

    response = client.post("/v1/translate", json=_payload())

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "SECURITY_VIOLATION"
    assert body["details"]["root_operation"] == "DROP"


def test_reports_an_unanswerable_question(client, fake_llm):
    fake_llm.responses = ["HELIXQL_UNANSWERABLE: no revenue table in the blueprint"]

    response = client.post("/v1/translate", json=_payload())

    assert response.status_code == 422
    assert response.json()["code"] == "QUESTION_UNANSWERABLE"
    assert "revenue" in response.json()["error"]


def test_repair_uses_the_repair_path_and_is_not_metered(client, fake_llm, fake_control_plane):
    fake_llm.responses = ["SELECT name FROM users"]

    response = client.post(
        "/v1/translate",
        json=_payload(
            repair={"sql": "SELECT u.customer_id FROM users u", "error": "Unknown column 'u.customer_id'", "attempt": 1}
        ),
    )

    assert response.status_code == 200
    assert response.json()["attempt"] == 2
    assert fake_llm.repair_calls and not fake_llm.translate_calls
    assert fake_llm.repair_calls[0]["error"] == "Unknown column 'u.customer_id'"
    # A self-heal retry fixes the model's own mistake; charging for it would
    # bill the user three times for one question.
    assert fake_control_plane.increment_calls == []


def test_repair_attempts_are_capped(client, fake_llm, settings):
    response = client.post(
        "/v1/translate",
        json=_payload(repair={"sql": "SELECT 1", "error": "boom", "attempt": settings.max_repair_attempts + 1}),
    )

    assert response.status_code == 429
    assert fake_llm.repair_calls == []


def test_applies_the_row_cap_to_generated_sql(client, fake_llm, settings):
    fake_llm.responses = ["SELECT * FROM users"]

    body = client.post("/v1/translate", json=_payload()).json()

    assert body["limit_applied"] == settings.max_result_rows
    assert f"LIMIT {settings.max_result_rows}" in body["sql"]


def test_rejects_an_empty_schema_blueprint(client):
    response = client.post("/v1/translate", json=_payload(schema_ddl=[]))
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_REQUEST"


def test_rejects_an_unknown_dialect(client):
    response = client.post("/v1/translate", json=_payload(dialect="oracle"))
    assert response.status_code == 400


def test_validate_route_runs_the_guardrail_without_the_model(client, fake_llm, fake_control_plane):
    ok = client.post("/v1/validate", json={"sql": "SELECT id FROM users", "dialect": "mysql"})
    blocked = client.post("/v1/validate", json={"sql": "DELETE FROM users", "dialect": "mysql"})

    assert ok.status_code == 200
    assert ok.json()["tables"] == ["users"]
    assert blocked.status_code == 422
    assert fake_llm.translate_calls == []
    assert fake_control_plane.increment_calls == []


def test_requires_an_api_token(unauthenticated_client):
    response = unauthenticated_client.post("/v1/translate", json=_payload())
    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_API_TOKEN"


def test_accepts_the_token_via_header(unauthenticated_client):
    response = unauthenticated_client.post(
        "/v1/translate", json=_payload(), headers={"X-API-Token": "hql_live_abc"}
    )
    assert response.status_code == 200


def test_accepts_a_bearer_token(unauthenticated_client):
    response = unauthenticated_client.post(
        "/v1/translate", json=_payload(), headers={"Authorization": "Bearer hql_live_abc"}
    )
    assert response.status_code == 200


def test_health_endpoint(client):
    assert client.get("/health").json() == {"status": "ok"}
