import json

import httpx
import pytest

from app.config import Settings
from app.errors import LlmUnavailableError, TranslationError
from app.services.llm import create_engine
from app.services.ollama import OllamaSynthesisEngine

BASE = {"control_plane_internal_secret": "test-secret"}
SCHEMA = ["CREATE TABLE users (id INT, name VARCHAR(100));"]


def settings(**overrides) -> Settings:
    return Settings(**BASE, **{"llm_provider": "ollama", "ollama_model": "qwen2.5:3b", **overrides})  # type: ignore[arg-type]


def engine_with(handler) -> tuple[OllamaSynthesisEngine, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    return OllamaSynthesisEngine(settings(), httpx.AsyncClient(transport=httpx.MockTransport(record))), seen


def chat(content: str) -> httpx.Response:
    return httpx.Response(200, json={"message": {"role": "assistant", "content": content}, "done": True})


async def test_translates_through_the_native_chat_route():
    engine, seen = engine_with(lambda _: chat("```sql\nSELECT id FROM users;\n```"))

    assert await engine.translate("all user ids", SCHEMA, "mysql") == "SELECT id FROM users"

    request = seen[0]
    assert request.url.path == "/api/chat"
    body = json.loads(request.content)
    assert body["model"] == "qwen2.5:3b"
    assert body["stream"] is False
    # The reason the native route is used at all: the default window is too
    # small for a blueprint and would truncate the prompt silently.
    assert body["options"]["num_ctx"] == 8192
    assert body["options"]["temperature"] == 0.0
    assert "Authorization" not in request.headers


async def test_strips_a_reasoning_block():
    engine, _ = engine_with(lambda _: chat("<think>users table has id</think>\nSELECT id FROM users"))
    assert await engine.translate("ids", SCHEMA, "mysql") == "SELECT id FROM users"


async def test_a_missing_model_says_how_to_pull_it():
    engine, _ = engine_with(lambda _: httpx.Response(404, json={"error": "model 'qwen2.5:3b' not found"}))

    with pytest.raises(LlmUnavailableError, match="ollama pull qwen2.5:3b"):
        await engine.translate("ids", SCHEMA, "mysql")


async def test_an_unreachable_server_says_ollama_is_not_running():
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    engine, _ = engine_with(refuse)

    with pytest.raises(LlmUnavailableError, match="ollama serve"):
        await engine.translate("ids", SCHEMA, "mysql")


async def test_an_empty_reply_is_a_translation_error():
    engine, _ = engine_with(lambda _: chat("   "))

    with pytest.raises(TranslationError):
        await engine.translate("ids", SCHEMA, "mysql")


async def test_inherits_the_other_engine_methods():
    engine, _ = engine_with(lambda _: chat('{"status": "ready", "resolved_question": "All user ids"}'))

    result = await engine.clarify("ids", SCHEMA, [], max_turns=3)

    assert result.status == "ready"
    assert result.resolved_question == "All user ids"


def test_is_selected_by_provider_without_any_api_key():
    assert isinstance(create_engine(settings(gemini_api_key="", groq_api_key="")), OllamaSynthesisEngine)
