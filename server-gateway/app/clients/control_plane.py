import logging
from typing import Any

import httpx

from app.config import Settings
from app.errors import (
    ControlPlaneUnavailableError,
    InvalidTokenError,
    QueryLimitExceededError,
    SubscriptionError,
)

logger = logging.getLogger(__name__)

INTERNAL_SECRET_HEADER = "X-Internal-Secret"


class ControlPlaneClient:
    """
    Thin async wrapper over the control plane's /api/internal/* routes.

    The gateway deliberately holds no MongoDB connection of its own: token
    validation and quota accounting live in exactly one implementation, in
    the control plane (see its README architecture note). That makes this
    client the gateway's only source of truth about who a caller is.
    """

    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    async def _post(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        url = f"{self._settings.control_plane_base_url.rstrip('/')}{path}"
        try:
            return await self._http.post(
                url,
                json=payload,
                headers={INTERNAL_SECRET_HEADER: self._settings.control_plane_internal_secret},
                timeout=self._settings.control_plane_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            logger.error("Control plane request to %s failed: %s", path, exc)
            raise ControlPlaneUnavailableError(
                "The HelixQL account service is temporarily unreachable. Please retry shortly."
            ) from exc

    @staticmethod
    def _json(response: httpx.Response) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError as exc:
            raise ControlPlaneUnavailableError("The account service returned a malformed response.") from exc
        if not isinstance(body, dict):
            raise ControlPlaneUnavailableError("The account service returned a malformed response.")
        return body

    async def verify_api_token(self, api_token: str) -> str:
        """Returns the owning user id, or raises. Implements FR-3.1."""
        response = await self._post("/api/internal/tokens/verify", {"apiToken": api_token})

        if response.status_code == 200:
            body = self._json(response)
            user_id = body.get("userId")
            if not body.get("valid") or not isinstance(user_id, str):
                raise InvalidTokenError("This api_token is not valid. Sign in again from the desktop app.")
            return user_id

        if response.status_code == 403:
            raise InvalidTokenError("This api_token is invalid, revoked, or belongs to an inactive account.")

        # A 401 here means *our* X-Internal-Secret was rejected — a gateway
        # misconfiguration, never the end user's fault. Surfacing it as an
        # auth error would send the operator chasing their own token.
        if response.status_code == 401:
            logger.error("Control plane rejected the gateway's internal secret — check CONTROL_PLANE_INTERNAL_SECRET")
            raise ControlPlaneUnavailableError("The gateway is not authorized to reach the account service.")

        logger.error("Unexpected %s from control plane token verify", response.status_code)
        raise ControlPlaneUnavailableError("The account service returned an unexpected response.")

    async def increment_usage(self, user_id: str) -> dict[str, int]:
        """
        Meters one query against the user's monthly allowance (FR-3.2).

        The control plane performs the check-and-increment as a single
        conditional update, so this is safe to call concurrently for the
        same user without over-counting or letting a request slip past the
        cap.
        """
        response = await self._post("/api/internal/usage/increment", {"userId": user_id})

        if response.status_code == 200:
            body = self._json(response)
            return {
                "remaining": int(body.get("remaining", 0)),
                "monthly_query_limit": int(body.get("monthlyQueryLimit", 0)),
            }

        if response.status_code == 429:
            body = self._json(response)
            raise QueryLimitExceededError(
                str(body.get("error") or "Monthly query allowance exceeded for this plan.")
            )

        if response.status_code == 404:
            body = self._json(response)
            raise SubscriptionError(str(body.get("error") or "No active subscription found for this account."))

        if response.status_code == 401:
            logger.error("Control plane rejected the gateway's internal secret on usage increment")
            raise ControlPlaneUnavailableError("The gateway is not authorized to reach the account service.")

        logger.error("Unexpected %s from control plane usage increment", response.status_code)
        raise ControlPlaneUnavailableError("The account service returned an unexpected response.")
