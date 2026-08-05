import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.clients.control_plane import ControlPlaneClient
from app.config import get_settings
from app.errors import GatewayError
from app.routers import translate
from app.services.llm import create_engine

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Build the shared, long-lived clients once per process.

    The HTTP client in particular must be shared: a per-request client would
    reopen a TLS connection to the control plane on every translation, which
    is the single hottest path in this service.
    """
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    http = httpx.AsyncClient(timeout=settings.control_plane_timeout_seconds)
    app.state.settings = settings
    app.state.http = http
    app.state.control_plane = ControlPlaneClient(http, settings)
    app.state.llm = create_engine(settings)

    logger.info(
        "HelixQL gateway ready (provider=%s, control_plane=%s)",
        settings.llm_provider,
        settings.control_plane_base_url,
    )
    try:
        yield
    finally:
        await http.aclose()


app = FastAPI(
    title="HelixQL Gateway",
    version="1.0.0",
    description=(
        "Stateless translation and syntax-security tier. Converts natural language plus an "
        "anonymous schema blueprint into a verified read-only SQL string. Never receives "
        "database credentials, and never connects to a customer database."
    ),
    lifespan=lifespan,
)

_cors_origins = get_settings().cors_origins
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=False,
        allow_methods=["POST", "GET"],
        allow_headers=["Content-Type", "X-API-Token", "Authorization"],
    )


@app.exception_handler(GatewayError)
async def gateway_error_handler(_: Request, exc: GatewayError) -> JSONResponse:
    """Renders every domain failure in one shape: {error, code, details?}."""
    return JSONResponse(status_code=exc.status_code, content=exc.to_payload())


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else None
    field = ".".join(str(part) for part in first["loc"][1:]) if first else ""
    message = f"{field}: {first['msg']}" if first and field else "Invalid request payload."
    return JSONResponse(status_code=400, content={"error": message, "code": "INVALID_REQUEST"})


@app.get("/health", tags=["ops"])
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(translate.router)
