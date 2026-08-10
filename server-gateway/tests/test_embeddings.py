import json

import httpx
import pytest

from app.config import Settings
from app.errors import EmbeddingUnavailableError
from app.services.embeddings import QUERY_INSTRUCTION, HuggingFaceEmbedder, create_embedder

BASE = {"control_plane_internal_secret": "test-secret"}


def settings(**overrides) -> Settings:
    return Settings(**BASE, **overrides)  # type: ignore[arg-type]


def embedder_returning(*responses: httpx.Response, **overrides) -> tuple[HuggingFaceEmbedder, list[httpx.Request]]:
    """Builds an embedder whose upstream replays the given responses in order."""
    seen: list[httpx.Request] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return queue.pop(0) if queue else responses[-1]

    config = settings(hf_token="hf_test", **overrides)
    return HuggingFaceEmbedder(config, httpx.AsyncClient(transport=httpx.MockTransport(handler))), seen


def vectors(*rows: list[float]) -> httpx.Response:
    return httpx.Response(200, json=list(rows))


async def test_embeds_a_batch_of_texts():
    embedder, seen = embedder_returning(vectors([3.0, 4.0], [0.0, 5.0]))

    result = await embedder.embed(["Table signup.", "Table invoices."])

    assert len(result) == 2
    request = seen[0]
    assert request.headers["Authorization"] == "Bearer hf_test"
    assert "BAAI/bge-small-en-v1.5" in str(request.url)
    assert str(request.url).endswith("/pipeline/feature-extraction")


async def test_normalizes_vectors_so_cosine_is_a_dot_product():
    """The desktop client scores similarity with a plain dot product, which
    is only correct if magnitudes are stripped here."""
    embedder, _ = embedder_returning(vectors([3.0, 4.0]))

    (vector,) = await embedder.embed(["anything"])

    assert vector == pytest.approx([0.6, 0.8])
    assert sum(value * value for value in vector) == pytest.approx(1.0)


async def test_applies_the_bge_query_prefix_only_to_questions():
    embedder, seen = embedder_returning(vectors([1.0, 0.0]))
    await embedder.embed(["how many users"], is_query=True)
    assert json.loads(seen[0].content)["inputs"] == [f"{QUERY_INSTRUCTION}how many users"]

    embedder, seen = embedder_returning(vectors([1.0, 0.0]))
    await embedder.embed(["Table signup."], is_query=False)
    assert json.loads(seen[0].content)["inputs"] == ["Table signup."]


async def test_mean_pools_a_token_level_response():
    """Some model servings return per-token vectors instead of a pooled
    sentence vector. Both shapes have to work — the difference would
    otherwise only appear in production."""
    embedder, _ = embedder_returning(httpx.Response(200, json=[[[1.0, 0.0], [0.0, 1.0]]]))

    (vector,) = await embedder.embed(["Table signup."])

    # Mean of the two tokens is [0.5, 0.5], normalized to equal components.
    assert vector == pytest.approx([0.7071, 0.7071], abs=1e-4)


async def test_handles_a_single_flat_vector():
    embedder, _ = embedder_returning(httpx.Response(200, json=[3.0, 4.0]))
    assert await embedder.embed(["one"]) == [pytest.approx([0.6, 0.8])]


async def test_an_empty_batch_makes_no_request():
    embedder, seen = embedder_returning(vectors([1.0]))
    assert await embedder.embed([]) == []
    assert seen == []


async def test_retries_a_rate_limit_then_succeeds():
    embedder, seen = embedder_returning(httpx.Response(429, json={"error": "slow down"}), vectors([1.0, 0.0]))

    assert len(await embedder.embed(["q"])) == 1
    assert len(seen) == 2


async def test_retries_while_the_model_is_still_loading():
    """HF returns 503 for a cold model, which resolves on its own."""
    embedder, seen = embedder_returning(httpx.Response(503, json={"error": "loading"}), vectors([1.0, 0.0]))

    assert len(await embedder.embed(["q"])) == 1
    assert len(seen) == 2


async def test_a_bad_token_fails_immediately_without_retrying():
    embedder, seen = embedder_returning(httpx.Response(401, json={"error": "invalid token"}))

    with pytest.raises(EmbeddingUnavailableError, match="credentials"):
        await embedder.embed(["q"])
    assert len(seen) == 1


async def test_a_mismatched_batch_is_rejected():
    """Silently mispairing vectors with tables would corrupt every score
    downstream, which is far worse than losing semantic ranking."""
    embedder, _ = embedder_returning(vectors([1.0, 0.0]))

    with pytest.raises(EmbeddingUnavailableError, match="mismatched"):
        await embedder.embed(["one", "two"])


async def test_an_unreadable_response_is_reported():
    embedder, _ = embedder_returning(httpx.Response(200, text="<html>not json</html>"))
    with pytest.raises(EmbeddingUnavailableError):
        await embedder.embed(["q"])


async def test_an_oversized_batch_is_rejected_before_the_network():
    embedder, seen = embedder_returning(vectors([1.0]), embedding_max_texts=2)

    with pytest.raises(EmbeddingUnavailableError, match="Too many"):
        await embedder.embed(["a", "b", "c"])
    assert seen == []


async def test_long_texts_are_truncated():
    embedder, seen = embedder_returning(vectors([1.0, 0.0]), embedding_max_chars=10)
    await embedder.embed(["x" * 500])
    assert json.loads(seen[0].content)["inputs"] == ["x" * 10]


async def test_without_a_token_it_reports_unavailable_rather_than_calling_out():
    """A gateway with no HF_TOKEN must degrade to lexical pruning on the
    client, not fail a user's question."""
    embedder = HuggingFaceEmbedder(settings(hf_token=""))

    assert embedder.enabled is False
    with pytest.raises(EmbeddingUnavailableError, match="HF_TOKEN"):
        await embedder.embed(["q"])


def test_the_factory_builds_an_embedder_either_way():
    """Startup must not depend on HF_TOKEN — the feature is optional."""
    assert create_embedder(settings(hf_token="hf_x")).enabled is True
    assert create_embedder(settings(hf_token="")).enabled is False


# --- Route behaviour ------------------------------------------------------


def test_embed_does_not_consume_the_users_query_allowance(client, fake_control_plane):
    """One question already costs one translation. Charging again for the
    ranking step would make the accurate path the expensive one."""
    client.post("/v1/embed", json={"texts": ["Table signup."]})
    assert fake_control_plane.increment_calls == []


def test_embed_passes_the_query_flag_through(client, fake_embedder):
    client.post("/v1/embed", json={"texts": ["how many users"], "is_query": True})
    assert fake_embedder.calls[0]["is_query"] is True


def test_embed_reports_the_vector_shape(client):
    body = client.post("/v1/embed", json={"texts": ["a", "b"]}).json()
    assert len(body["vectors"]) == 2
    assert body["dimensions"] == 3


def test_embed_surfaces_an_upstream_outage_as_a_recoverable_code(client, fake_embedder):
    """The desktop client branches on this code to fall back to lexical
    pruning, so it must survive as EMBEDDINGS_UNAVAILABLE rather than being
    flattened into a generic 500."""
    fake_embedder.error = EmbeddingUnavailableError("hugging face is down")

    response = client.post("/v1/embed", json={"texts": ["Table signup."]})

    assert response.status_code == 503
    assert response.json()["code"] == "EMBEDDINGS_UNAVAILABLE"


def test_embed_rejects_an_empty_batch(client):
    assert client.post("/v1/embed", json={"texts": []}).status_code == 400


def test_embed_rejects_a_blank_text(client):
    assert client.post("/v1/embed", json={"texts": ["   "]}).status_code == 400
