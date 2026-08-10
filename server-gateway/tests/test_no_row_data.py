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


def test_the_route_surface_is_exactly_what_is_expected():
    """A new route that accepts rows would show up here first.

    `/v1/embed` and `/v1/link-schema` were added for schema selection. Both
    widen the surface, so the tests below hold them to the same standard as
    translate and validate: identifier and question text in, no field in
    either schema that could carry a row.
    """
    assert {path for path in route_paths() if path.startswith("/v1/")} == {
        "/v1/translate",
        "/v1/validate",
        "/v1/embed",
        "/v1/link-schema",
    }


def test_link_schema_accepts_no_field_that_could_carry_rows():
    from app.schemas import LinkSchemaRequest

    assert set(LinkSchemaRequest.model_fields) == {"question", "catalog"}


def test_link_schema_ignores_a_payload_carrying_rows(client, fake_llm):
    response = client.post(
        "/v1/link-schema",
        json={
            "question": "how many users",
            "catalog": ["signup(id, email)"],
            "rows": [{"name": "Asha", "email": "asha@example.com"}],
        },
    )

    assert response.status_code == 200
    assert "Asha" not in str(fake_llm.link_calls)
    assert "asha@example.com" not in str(fake_llm.link_calls)


def test_embed_accepts_no_field_that_could_carry_rows():
    """The request schema is the enforcement point — a field that took
    structured data is what a leak would need, and there isn't one."""
    from app.schemas import EmbedRequest

    assert set(EmbedRequest.model_fields) == {"texts", "is_query"}


def test_embed_ignores_a_payload_carrying_rows(client, fake_embedder):
    response = client.post(
        "/v1/embed",
        json={
            "texts": ["Table signup. Columns: id, email."],
            "rows": [{"name": "Asha", "email": "asha@example.com"}],
        },
    )

    assert response.status_code == 200
    assert "Asha" not in str(fake_embedder.calls)
    assert "asha@example.com" not in str(fake_embedder.calls)


def test_embed_returns_vectors_not_text(client):
    """Nothing in the response echoes the input back, so the route cannot be
    used as a round-trip channel for content."""
    response = client.post("/v1/embed", json={"texts": ["Table signup."]})

    body = response.json()
    assert set(body) == {"vectors", "model", "dimensions"}
    assert "signup" not in str(body)


def test_embed_requires_authentication(unauthenticated_client):
    response = unauthenticated_client.post("/v1/embed", json={"texts": ["Table signup."]})
    assert response.status_code == 401


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
