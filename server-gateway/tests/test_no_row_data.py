"""
Guards the product's central privacy promise: no row of customer data ever
reaches this tier.

The summarize endpoint used to send a sample of result rows to the model for
a written answer. That was removed — a feature that trades away the isolation
guarantee is not worth having, and a client cannot be asked to accept it. The
tests below exist so nobody reintroduces the capability by accident.
"""

from app.main import app
from tests.conftest import TEST_SCHEMA


def route_paths() -> set[str]:
    """Read the published surface from the OpenAPI schema rather than
    walking `app.routes` — this FastAPI version keeps included routers in an
    opaque wrapper, so a naive walk sees only the top-level routes and would
    make these assertions pass vacuously."""
    return set(app.openapi()["paths"].keys())


def test_no_summarize_endpoint_exists():
    assert "/v1/summarize" not in route_paths()


def test_the_only_data_routes_are_translate_and_validate():
    """A new route that accepts rows would show up here first."""
    assert {path for path in route_paths() if path.startswith("/v1/")} == {"/v1/translate", "/v1/validate"}


def test_translate_rejects_a_payload_carrying_rows(client):
    """Extra fields are ignored by the schema rather than forwarded, so even
    a client that tried to attach rows could not get them to the model."""
    response = client.post(
        "/v1/translate",
        json={
            "question": "who ordered most",
            "schema_ddl": TEST_SCHEMA,
            "dialect": "mysql",
            "rows": [{"name": "Asha", "email": "asha@example.com"}],
        },
    )
    assert response.status_code == 200


def test_the_model_never_receives_row_data(client, fake_llm):
    """The prompt is built from the question and the empty CREATE TABLE
    blueprint only. Nothing else is in scope to leak."""
    client.post(
        "/v1/translate",
        json={
            "question": "who ordered most",
            "schema_ddl": TEST_SCHEMA,
            "dialect": "mysql",
            "rows": [{"name": "Asha", "email": "asha@example.com"}],
        },
    )

    call = fake_llm.translate_calls[0]
    assert call["schema_ddl"] == TEST_SCHEMA
    assert "Asha" not in str(call)
    assert "asha@example.com" not in str(call)


def test_the_llm_engine_exposes_no_summarize_method():
    from app.services.llm import GeminiSynthesisEngine

    assert not hasattr(GeminiSynthesisEngine, "summarize")


def test_no_summarizer_prompt_remains():
    from app.services import prompts

    assert not any("SUMMAR" in name.upper() for name in dir(prompts))
