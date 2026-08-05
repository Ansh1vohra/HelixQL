import httpx
import pytest

from app.clients.control_plane import INTERNAL_SECRET_HEADER, ControlPlaneClient
from app.config import get_settings
from app.errors import (
    ControlPlaneUnavailableError,
    InvalidTokenError,
    QueryLimitExceededError,
    SubscriptionError,
)


def build_client(handler) -> ControlPlaneClient:
    transport = httpx.MockTransport(handler)
    return ControlPlaneClient(httpx.AsyncClient(transport=transport), get_settings())


async def test_verify_token_returns_the_user_id():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["secret"] = request.headers[INTERNAL_SECRET_HEADER]
        return httpx.Response(200, json={"valid": True, "userId": "user-42"})

    assert await build_client(handler).verify_api_token("hql_live_x") == "user-42"
    assert seen["path"] == "/api/internal/tokens/verify"
    assert seen["secret"] == get_settings().control_plane_internal_secret


async def test_verify_token_rejects_an_invalid_token():
    handler = lambda request: httpx.Response(403, json={"valid": False})  # noqa: E731
    with pytest.raises(InvalidTokenError):
        await build_client(handler).verify_api_token("nope")


async def test_gateway_misconfiguration_is_not_reported_as_a_user_auth_failure():
    """A 401 means the control plane rejected *our* internal secret. Telling
    the operator their api_token is bad would send them chasing the wrong
    problem."""
    handler = lambda request: httpx.Response(401, json={"error": "Unauthorized"})  # noqa: E731
    with pytest.raises(ControlPlaneUnavailableError):
        await build_client(handler).verify_api_token("hql_live_x")


async def test_network_failure_surfaces_as_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(ControlPlaneUnavailableError):
        await build_client(handler).verify_api_token("hql_live_x")


async def test_increment_usage_returns_the_remaining_allowance():
    handler = lambda request: httpx.Response(  # noqa: E731
        200, json={"allowed": True, "remaining": 7, "monthlyQueryLimit": 100}
    )
    assert await build_client(handler).increment_usage("user-1") == {"remaining": 7, "monthly_query_limit": 100}


async def test_increment_usage_raises_on_quota_exhaustion():
    handler = lambda request: httpx.Response(429, json={"allowed": False, "error": "Monthly cap hit"})  # noqa: E731
    with pytest.raises(QueryLimitExceededError, match="Monthly cap hit"):
        await build_client(handler).increment_usage("user-1")


async def test_increment_usage_raises_when_no_subscription_exists():
    handler = lambda request: httpx.Response(404, json={"allowed": False, "error": "No subscription"})  # noqa: E731
    with pytest.raises(SubscriptionError):
        await build_client(handler).increment_usage("user-1")


async def test_malformed_response_body_is_handled():
    handler = lambda request: httpx.Response(200, text="<html>gateway timeout</html>")  # noqa: E731
    with pytest.raises(ControlPlaneUnavailableError):
        await build_client(handler).verify_api_token("hql_live_x")
