from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request

from app.clients.control_plane import ControlPlaneClient
from app.config import Settings, get_settings
from app.errors import InvalidTokenError
from app.services.embeddings import HuggingFaceEmbedder
from app.services.llm import GeminiSynthesisEngine

API_TOKEN_HEADER = "X-API-Token"


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str


def get_control_plane(request: Request) -> ControlPlaneClient:
    return request.app.state.control_plane


def get_llm_engine(request: Request) -> GeminiSynthesisEngine:
    return request.app.state.llm


def get_embedder(request: Request) -> HuggingFaceEmbedder:
    return request.app.state.embedder


def get_config() -> Settings:
    return get_settings()


async def authenticate(
    control_plane: Annotated[ControlPlaneClient, Depends(get_control_plane)],
    x_api_token: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    """
    Token authentication barrier for every translation route (Step 3.2 /
    FR-3.1).

    `X-API-Token` is the documented header; `Authorization: Bearer` is
    accepted too so the gateway is usable from standard HTTP tooling during
    testing without a second code path in the desktop client.
    """
    token = x_api_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]

    token = (token or "").strip()
    if not token:
        raise InvalidTokenError("Missing api_token. Send it in the X-API-Token header.")

    user_id = await control_plane.verify_api_token(token)
    return AuthenticatedUser(user_id=user_id)


CurrentUser = Annotated[AuthenticatedUser, Depends(authenticate)]
ControlPlaneDep = Annotated[ControlPlaneClient, Depends(get_control_plane)]
LlmDep = Annotated[GeminiSynthesisEngine, Depends(get_llm_engine)]
EmbedderDep = Annotated[HuggingFaceEmbedder, Depends(get_embedder)]
SettingsDep = Annotated[Settings, Depends(get_config)]
