import httpx
import pytest

from app.config import Settings
from app.errors import LlmUnavailableError, TranslationError, UnanswerableQuestionError
from app.services.groq import GroqSynthesisEngine
from app.services.llm import GeminiSynthesisEngine, create_engine

BASE = {"control_plane_internal_secret": "test-secret"}
SCHEMA = ["CREATE TABLE users (id INT, name VARCHAR(100));"]


def settings(**overrides) -> Settings:
    return Settings(**BASE, **overrides)  # type: ignore[arg-type]


def engine_returning(*responses: httpx.Response) -> tuple[GroqSynthesisEngine, list[httpx.Request]]:
    """Builds an engine whose upstream replays the given responses in order."""
    seen: list[httpx.Request] = []
    queue = list(responses)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return queue.pop(0) if queue else responses[-1]

    config = settings(llm_provider="groq", groq_api_key="gsk_test")
    return GroqSynthesisEngine(config, httpx.AsyncClient(transport=httpx.MockTransport(handler))), seen


def completion(content: str, finish_reason: str = "stop") -> httpx.Response:
    return httpx.Response(
        200,
        json={"choices": [{"index": 0, "finish_reason": finish_reason, "message": {"role": "assistant", "content": content}}]},
    )


async def test_translates_a_question():
    engine, seen = engine_returning(completion("SELECT id FROM users"))

    assert await engine.translate("list user ids", SCHEMA, "mysql") == "SELECT id FROM users"

    request = seen[0]
    assert request.url.path == "/openai/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer gsk_test"


async def test_pins_temperature_to_zero_for_determinism():
    import json

    engine, seen = engine_returning(completion("SELECT 1"))
    await engine.translate("q", SCHEMA, "mysql")

    payload = json.loads(seen[0].content)
    assert payload["temperature"] == 0.0
    assert payload["model"] == "openai/gpt-oss-120b"
    # System instruction first, then the schema + question turn.
    assert payload["messages"][0]["role"] == "system"
    assert "HelixQL" in payload["messages"][0]["content"]
    assert "CREATE TABLE users" in payload["messages"][1]["content"]


async def test_strips_markdown_fences_like_the_gemini_engine():
    engine, _ = engine_returning(completion("```sql\nSELECT id FROM users;\n```"))
    assert await engine.translate("q", SCHEMA, "mysql") == "SELECT id FROM users"


async def test_reports_an_unanswerable_question():
    engine, _ = engine_returning(completion("HELIXQL_UNANSWERABLE: no revenue table"))
    with pytest.raises(UnanswerableQuestionError, match="revenue"):
        await engine.translate("q", SCHEMA, "mysql")


async def test_repairs_a_failed_query():
    import json

    engine, seen = engine_returning(completion("SELECT name FROM users"))

    result = await engine.repair("q", SCHEMA, "mysql", "SELECT bogus FROM users", "Unknown column 'bogus'", 1)

    assert result == "SELECT name FROM users"
    payload = json.loads(seen[0].content)
    assert "Unknown column 'bogus'" in payload["messages"][1]["content"]


async def test_retries_a_rate_limit_then_succeeds():
    engine, seen = engine_returning(httpx.Response(429, json={"error": "slow down"}), completion("SELECT 1"))

    assert await engine.translate("q", SCHEMA, "mysql") == "SELECT 1"
    assert len(seen) == 2


async def test_retries_a_server_error_then_succeeds():
    engine, seen = engine_returning(httpx.Response(503, text="upstream down"), completion("SELECT 1"))

    assert await engine.translate("q", SCHEMA, "mysql") == "SELECT 1"
    assert len(seen) == 2


async def test_gives_up_after_repeated_rate_limits():
    engine, seen = engine_returning(*[httpx.Response(429, json={"error": "slow down"}) for _ in range(3)])

    with pytest.raises(LlmUnavailableError, match="busy"):
        await engine.translate("q", SCHEMA, "mysql")
    assert len(seen) == 3


async def test_a_bad_api_key_fails_immediately_without_retrying():
    engine, seen = engine_returning(httpx.Response(401, json={"error": "invalid api key"}))

    with pytest.raises(LlmUnavailableError, match="credentials"):
        await engine.translate("q", SCHEMA, "mysql")
    assert len(seen) == 1


async def test_an_empty_completion_is_reported():
    engine, _ = engine_returning(completion("", finish_reason="length"))
    with pytest.raises(TranslationError):
        await engine.translate("q", SCHEMA, "mysql")


async def test_an_unreadable_response_is_reported():
    engine, _ = engine_returning(httpx.Response(200, text="<html>not json</html>"))
    with pytest.raises(TranslationError):
        await engine.translate("q", SCHEMA, "mysql")


# --- Provider selection ---------------------------------------------------


def test_factory_builds_the_configured_provider():
    assert isinstance(create_engine(settings(llm_provider="groq", groq_api_key="gsk_x")), GroqSynthesisEngine)
    assert isinstance(create_engine(settings(llm_provider="gemini", gemini_api_key="k")), GeminiSynthesisEngine)


def test_missing_provider_key_fails_at_startup_not_at_query_time():
    """A misconfigured key should stop the process coming up, rather than
    surfacing as an opaque upstream error on someone's first question."""
    with pytest.raises(ValueError, match="GROQ_API_KEY"):
        create_engine(settings(llm_provider="groq", groq_api_key=""))
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        create_engine(settings(llm_provider="gemini", gemini_api_key=""))


def test_both_engines_expose_the_same_interface():
    """The router depends on this; a drift would only show up in production."""
    for name in ("translate", "repair"):
        assert callable(getattr(GroqSynthesisEngine, name))
        assert callable(getattr(GeminiSynthesisEngine, name))
