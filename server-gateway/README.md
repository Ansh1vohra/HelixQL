# HelixQL Gateway

Stateless Python FastAPI microservice: translates natural-language questions
into SQL via Google Gemini, validates the result through a SQLGlot AST
guardrail, and authenticates/meters requests against the control plane. See
`/HelixQL.pdf` at the repo root for the full spec.

Scaffolded in Phase 2; the translation endpoint itself is built in Phase 3.

## Local development

```bash
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # fill in GEMINI_API_KEY and CONTROL_PLANE_INTERNAL_SECRET
uvicorn app.main:app --reload --port 8000
```

`GET /health` should return `{"status": "ok"}`.
