import logging

from fastapi import APIRouter

from app.dependencies import CurrentUser, EmbedderDep
from app.schemas import EmbedRequest, EmbedResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["embeddings"])


@router.post("/embed", response_model=EmbedResponse)
async def embed(payload: EmbedRequest, user: CurrentUser, embedder: EmbedderDep) -> EmbedResponse:
    """
    Embed identifier text so the desktop client can rank tables by meaning
    rather than spelling (see `services/embeddings.py` for the why).

    Authenticated but **not metered**, deliberately. A user's monthly
    allowance counts questions answered, and one question already costs one
    translation; charging again for the embedding that made the translation
    accurate would penalize the better-ranked path. Abuse is bounded by the
    batch limits in `EmbedRequest` instead — this route calls no LLM and
    cannot produce SQL, so the ceiling it needs is a size cap, not a quota.

    Failures here surface as EMBEDDINGS_UNAVAILABLE, which the client
    handles by falling back to lexical pruning rather than failing the
    user's question.
    """
    vectors = await embedder.embed(payload.texts, is_query=payload.is_query)

    logger.info(
        "embed user=%s texts=%s is_query=%s model=%s",
        user.user_id,
        len(payload.texts),
        payload.is_query,
        embedder.model,
    )

    return EmbedResponse(
        vectors=vectors,
        model=embedder.model,
        dimensions=len(vectors[0]) if vectors else 0,
    )
