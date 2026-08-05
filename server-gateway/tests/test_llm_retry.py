import pytest
from google.genai import errors as genai_errors

from app.config import Settings
from app.errors import LlmUnavailableError
from app.services.llm import GeminiSynthesisEngine

BASE = {"gemini_api_key": "test-key", "control_plane_internal_secret": "test-secret"}


class FakeResponse:
    def __init__(self, text: str) -> None:
        self.text = text
        self.candidates = []


def engine(**overrides) -> GeminiSynthesisEngine:
    return GeminiSynthesisEngine(Settings(**BASE, **overrides))  # type: ignore[arg-type]


def rate_limit_error() -> genai_errors.ClientError:
    return genai_errors.ClientError(429, {"error": {"code": 429, "message": "RESOURCE_EXHAUSTED"}})


def patch_generate(target: GeminiSynthesisEngine, responses: list) -> list[int]:
    """Replaces the SDK call with a scripted sequence, counting invocations."""
    calls: list[int] = []

    async def fake_generate_content(**_kwargs):
        calls.append(1)
        value = responses.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    target._client.aio.models.generate_content = fake_generate_content  # type: ignore[assignment]
    return calls


async def test_retries_a_rate_limit_and_succeeds():
    """A single 429 burst must not fail the user's query — the free tier
    rate limits readily, and one backoff usually clears it."""
    subject = engine()
    calls = patch_generate(subject, [rate_limit_error(), FakeResponse("SELECT 1")])

    assert await subject.translate("q", ["CREATE TABLE t (id INT);"], "mysql") == "SELECT 1"
    assert len(calls) == 2


async def test_gives_up_after_repeated_rate_limits():
    subject = engine()
    calls = patch_generate(subject, [rate_limit_error() for _ in range(3)])

    with pytest.raises(LlmUnavailableError, match="busy"):
        await subject.translate("q", ["CREATE TABLE t (id INT);"], "mysql")

    # Bounded: three attempts, then a clean client-facing error.
    assert len(calls) == 3


async def test_server_errors_are_retried_too():
    subject = engine()
    server_error = genai_errors.ServerError(503, {"error": {"code": 503, "message": "UNAVAILABLE"}})
    calls = patch_generate(subject, [server_error, FakeResponse("SELECT 1")])

    assert await subject.translate("q", ["CREATE TABLE t (id INT);"], "mysql") == "SELECT 1"
    assert len(calls) == 2


async def test_a_non_retryable_client_error_fails_immediately():
    """A 400 means the request itself is wrong; retrying it just wastes the
    user's time on an identical failure."""
    subject = engine()
    bad_request = genai_errors.ClientError(400, {"error": {"code": 400, "message": "INVALID_ARGUMENT"}})
    calls = patch_generate(subject, [bad_request])

    with pytest.raises(LlmUnavailableError):
        await subject.translate("q", ["CREATE TABLE t (id INT);"], "mysql")
    assert len(calls) == 1


async def test_the_internal_rate_limit_marker_never_escapes():
    """`_RetryableRateLimit` is an implementation detail. If it reached a
    route it would render as a 500 with no usable error code."""
    subject = engine()
    patch_generate(subject, [rate_limit_error() for _ in range(3)])

    with pytest.raises(LlmUnavailableError):
        await subject.repair("q", ["CREATE TABLE t (id INT);"], "mysql", "SELECT bad", "boom", 1)
