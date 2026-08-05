from typing import Any


class GatewayError(Exception):
    """
    Base for every failure the gateway reports to a desktop client.

    Carries an HTTP status plus a stable machine-readable `code`, so the
    Electron client can branch on the code (e.g. show the upgrade prompt on
    QUERY_LIMIT_EXCEEDED, show the red guardrail banner on
    SECURITY_VIOLATION) without string-matching on messages.
    """

    status_code: int = 500
    code: str = "INTERNAL_ERROR"

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"error": self.message, "code": self.code}
        if self.details:
            payload["details"] = self.details
        return payload


class InvalidTokenError(GatewayError):
    """The api_token is missing, malformed, or rejected by the control plane."""

    status_code = 401
    code = "INVALID_API_TOKEN"


class QueryLimitExceededError(GatewayError):
    """The user's monthly query allowance is exhausted (FR-3.2)."""

    status_code = 429
    code = "QUERY_LIMIT_EXCEEDED"


class SubscriptionError(GatewayError):
    """The account has no usable subscription attached."""

    status_code = 402
    code = "SUBSCRIPTION_REQUIRED"


class ControlPlaneUnavailableError(GatewayError):
    """The control plane is unreachable or returned an unexpected response."""

    status_code = 503
    code = "CONTROL_PLANE_UNAVAILABLE"


class SecurityViolationError(GatewayError):
    """
    The AST guardrail rejected the query (FR-3.5).

    422 rather than 400: the request itself was well-formed, but the
    resulting query is not something this gateway will ever hand back.
    """

    status_code = 422
    code = "SECURITY_VIOLATION"


class UnanswerableQuestionError(GatewayError):
    """
    The pruned schema blueprint cannot answer the question.

    Reported explicitly rather than letting the model invent a query over
    tables that don't exist — a confident wrong answer is worse here than a
    clear "rephrase your question".
    """

    status_code = 422
    code = "QUESTION_UNANSWERABLE"


class TranslationError(GatewayError):
    """The model returned something that could not be used as SQL."""

    status_code = 502
    code = "TRANSLATION_FAILED"


class LlmUnavailableError(GatewayError):
    """The upstream model API errored, timed out, or was rate limited."""

    status_code = 503
    code = "LLM_UNAVAILABLE"
