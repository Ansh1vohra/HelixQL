"""
Semantic schema matching via Hugging Face's hosted Inference API.

Why this exists
---------------
The desktop client prunes the schema down to the tables a question needs
before anything leaves the machine. That pruning was originally pure string
matching, which fails on the single most common real-world case: a table
whose *name* shares no words with how people talk about it. A database that
stores its users in a table called `signup` would lose "how many users do we
have?" to any unrelated table with the literal substring `user` in its name.
No amount of stemming fixes that — the two words are lexically unrelated and
semantically identical.

Embeddings put both into a vector space where "signup" and "users" land
close together, so the ranking follows meaning instead of spelling.

Privacy note — read before changing this
----------------------------------------
This is the one place where the "nothing about the schema is judged
off-machine" property is traded away. Table and column *names* (never rows,
never values) are sent to Hugging Face to be embedded. Two things keep the
blast radius small, and both are load-bearing:

  1. The client embeds its schema **once per connection** and caches the
     vectors locally. Per-question traffic is the question text alone —
     which already goes upstream for translation regardless.
  2. Nothing here is authoritative. The vectors only *rank* tables; the AST
     guardrail and the read-only transaction downstream are what actually
     constrain what a query can do.

If that trade ever needs reversing, this module is the seam: swap the
transport for a locally-hosted model and every caller above is unchanged.
"""

import logging
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import Settings
from app.errors import EmbeddingUnavailableError

logger = logging.getLogger(__name__)

# BGE models are trained asymmetrically: the short search phrase gets an
# instruction prefix, the indexed document does not. Skipping this costs a
# few points of retrieval accuracy on exactly the short-query case that
# matters most here. The model card specifies this exact string.
QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "


class _RetryableUpstream(Exception):
    """Internal marker for a retryable 429/5xx. Never escapes this module."""


class HuggingFaceEmbedder:
    """
    Turns text into normalized vectors through HF's feature-extraction
    pipeline.

    Vectors come back L2-normalized, so a caller computing similarity only
    needs a dot product — no magnitudes to carry around, and the desktop
    client's scoring stays trivial to audit.
    """

    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        # Injectable so tests can drive it with httpx.MockTransport.
        self._http = http or httpx.AsyncClient(timeout=settings.embedding_timeout_seconds)

    @property
    def model(self) -> str:
        return self._settings.embedding_model

    @property
    def enabled(self) -> bool:
        return self._settings.embeddings_enabled

    @retry(
        retry=retry_if_exception_type(_RetryableUpstream),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    )
    async def _post(self, texts: list[str]) -> Any:
        url = f"{self._settings.embedding_base_url.rstrip('/')}/{self._settings.embedding_model}/pipeline/feature-extraction"

        try:
            response = await self._http.post(
                url,
                json={"inputs": texts, "options": {"wait_for_model": True}},
                headers={"Authorization": f"Bearer {self._settings.hf_token}"},
                timeout=self._settings.embedding_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            logger.error("Hugging Face request failed: %s", exc)
            raise EmbeddingUnavailableError("The embedding service could not be reached.") from exc

        if response.status_code == 429:
            logger.warning("Hugging Face rate limited the gateway — backing off")
            raise _RetryableUpstream(response.text[:300])
        if response.status_code == 503:
            # 503 here usually means "model is loading", not "service is
            # down". It resolves on its own within a few seconds, so it is
            # worth the same backoff as a rate limit.
            logger.info("Hugging Face model still loading — backing off")
            raise _RetryableUpstream(response.text[:300])
        if response.status_code >= 500:
            logger.warning("Hugging Face server error %s — backing off", response.status_code)
            raise _RetryableUpstream(response.text[:300])
        if response.status_code in (401, 403):
            logger.error("Hugging Face rejected HF_TOKEN")
            raise EmbeddingUnavailableError("The embedding service rejected the gateway's credentials.")
        if response.status_code >= 400:
            logger.error("Hugging Face rejected the request: %s %s", response.status_code, response.text[:300])
            raise EmbeddingUnavailableError("The embedding service rejected the request.")

        try:
            return response.json()
        except ValueError as exc:
            logger.error("Unreadable Hugging Face response: %s", response.text[:300])
            raise EmbeddingUnavailableError("The embedding service returned an unreadable response.") from exc

    async def embed(self, texts: list[str], *, is_query: bool = False) -> list[list[float]]:
        """
        Embed a batch of texts, preserving input order.

        `is_query` selects the asymmetric prefix: set it for the user's
        question, leave it off for table descriptions.
        """
        if not self.enabled:
            raise EmbeddingUnavailableError(
                "Semantic schema matching is not configured on this gateway (HF_TOKEN is unset)."
            )
        if not texts:
            return []
        if len(texts) > self._settings.embedding_max_texts:
            raise EmbeddingUnavailableError(
                f"Too many texts in one embedding request (limit {self._settings.embedding_max_texts})."
            )

        limit = self._settings.embedding_max_chars
        prepared = [
            (QUERY_INSTRUCTION + text.strip() if is_query else text.strip())[:limit]
            for text in texts
        ]

        raw = await self._post(prepared)
        vectors = _to_vectors(raw)

        if len(vectors) != len(texts):
            logger.error("Embedder returned %s vectors for %s texts", len(vectors), len(texts))
            raise EmbeddingUnavailableError("The embedding service returned a mismatched batch.")

        return [_normalize(vector) for vector in vectors]

    async def aclose(self) -> None:
        await self._http.aclose()


def _normalize(vector: list[float]) -> list[float]:
    """L2-normalize so downstream cosine similarity is a plain dot product."""
    magnitude = sum(value * value for value in vector) ** 0.5
    if magnitude == 0:
        return vector
    return [value / magnitude for value in vector]


def _mean_pool(token_vectors: list[list[float]]) -> list[float]:
    """Average token vectors into one sentence vector."""
    count = len(token_vectors)
    width = len(token_vectors[0])
    return [sum(token[i] for token in token_vectors) / count for i in range(width)]


def _to_vectors(raw: Any) -> list[list[float]]:
    """
    Normalize HF's response shape into one vector per input.

    The feature-extraction pipeline returns pooled sentence vectors (2D) for
    sentence-transformers models, but falls back to per-token vectors (3D)
    depending on how a model is served. Both shapes are accepted rather than
    assumed, because the difference only ever shows up in production against
    a model we didn't test with.
    """
    if not isinstance(raw, list) or not raw:
        raise EmbeddingUnavailableError("The embedding service returned an unexpected shape.")

    first = raw[0]

    if isinstance(first, (int, float)):
        # A single vector for a single input.
        return [[float(value) for value in raw]]

    if isinstance(first, list) and first and isinstance(first[0], (int, float)):
        return [[float(value) for value in vector] for vector in raw]

    if isinstance(first, list) and first and isinstance(first[0], list):
        return [_mean_pool([[float(v) for v in token] for token in sequence]) for sequence in raw]

    raise EmbeddingUnavailableError("The embedding service returned an unexpected shape.")


def create_embedder(settings: Settings) -> HuggingFaceEmbedder:
    if settings.embeddings_enabled:
        logger.info("Semantic schema matching enabled (model=%s)", settings.embedding_model)
    else:
        logger.warning("HF_TOKEN unset — schema pruning will fall back to lexical matching only")
    return HuggingFaceEmbedder(settings)
