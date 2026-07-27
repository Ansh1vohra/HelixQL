from fastapi import FastAPI

app = FastAPI(title="HelixQL Gateway")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Phase 3 wires in: POST /translate (auth via app.config.Settings,
# LLM synthesis, SQLGlot AST guardrail) and the self-healing retry loop.
