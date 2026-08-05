import os

# Settings are read at import time (fail-fast on misconfiguration), so the
# environment has to be in place before `app.*` is imported anywhere. This
# also insulates the suite from whatever sits in the developer's real .env.
os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("CONTROL_PLANE_INTERNAL_SECRET", "test-internal-secret")
os.environ.setdefault("CONTROL_PLANE_BASE_URL", "http://control-plane.test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.dependencies import AuthenticatedUser, authenticate, get_control_plane, get_llm_engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services.llm import _clean_sql  # noqa: E402

TEST_SCHEMA = ["CREATE TABLE users (id INT, name VARCHAR(100), state VARCHAR(50));"]


class FakeLlm:
    """
    Stands in for Gemini. Records what it was asked and replays queued
    responses, so route behaviour can be tested without a network call or a
    billed token.

    Queued SQL responses run through the production `_clean_sql` normalizer,
    exactly as the real engine does. Without that the fake would silently
    hand the routes tidier output than Gemini ever produces, and the tests
    covering markdown fences and the unanswerable sentinel would be proving
    nothing.
    """

    def __init__(self) -> None:
        self.responses: list[str | Exception] = []
        self.translate_calls: list[dict] = []
        self.repair_calls: list[dict] = []

    def _next(self) -> str:
        if not self.responses:
            return "SELECT id FROM users"
        value = self.responses.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    async def translate(self, question: str, schema_ddl: list[str], dialect: str) -> str:
        self.translate_calls.append({"question": question, "schema_ddl": schema_ddl, "dialect": dialect})
        return _clean_sql(self._next())

    async def repair(self, **kwargs) -> str:
        self.repair_calls.append(kwargs)
        return _clean_sql(self._next())



class FakeControlPlane:
    def __init__(self) -> None:
        self.increment_calls: list[str] = []
        self.increment_error: Exception | None = None

    async def verify_api_token(self, api_token: str) -> str:
        return "user-1"

    async def increment_usage(self, user_id: str) -> dict[str, int]:
        self.increment_calls.append(user_id)
        if self.increment_error:
            raise self.increment_error
        return {"remaining": 42, "monthly_query_limit": 100}


@pytest.fixture
def fake_llm() -> FakeLlm:
    return FakeLlm()


@pytest.fixture
def fake_control_plane() -> FakeControlPlane:
    return FakeControlPlane()


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def client(fake_llm: FakeLlm, fake_control_plane: FakeControlPlane):
    app.dependency_overrides[get_llm_engine] = lambda: fake_llm
    app.dependency_overrides[get_control_plane] = lambda: fake_control_plane
    app.dependency_overrides[authenticate] = lambda: AuthenticatedUser(user_id="user-1")
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def unauthenticated_client(fake_llm: FakeLlm, fake_control_plane: FakeControlPlane):
    """Leaves the real `authenticate` dependency in place so header handling
    and control-plane rejection paths are exercised for real."""
    app.dependency_overrides[get_llm_engine] = lambda: fake_llm
    app.dependency_overrides[get_control_plane] = lambda: fake_control_plane
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
