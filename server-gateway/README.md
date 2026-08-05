# HelixQL Gateway

Stateless Python FastAPI microservice: translates natural-language questions
into SQL via Google Gemini, validates the result through a SQLGlot AST
guardrail, and authenticates/meters requests against the control plane. See
`/HelixQL.pdf` at the repo root for the full spec.

**This tier never sees a database credential and never connects to a customer
database.** It receives an English question plus empty `CREATE TABLE`
blueprints, and returns a verified read-only SQL string. Execution happens
entirely inside the customer's network, in the Electron client.

## Local development

```bash
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # fill in GEMINI_API_KEY and CONTROL_PLANE_INTERNAL_SECRET
uvicorn app.main:app --reload --port 8000
```

`GET /health` should return `{"status": "ok"}`. Interactive API docs are at
`http://localhost:8000/docs`.

```bash
pip install -r requirements-dev.txt
pytest
```

## API

Every route below requires the user's `api_token` in an `X-API-Token` header
(`Authorization: Bearer <token>` also works). The gateway resolves it through
the control plane — it holds no database of its own.

### `POST /v1/translate`

The main pipeline. Also serves the self-healing retry when `repair` is
present.

```jsonc
{
  "question": "Who made the most orders from Gujarat this month?",
  "schema_ddl": ["CREATE TABLE users (...)", "CREATE TABLE orders (...)"],
  "dialect": "mysql",                    // or "postgres"
  "repair": {                            // optional — self-heal (FR-4.5)
    "sql": "SELECT u.customer_id FROM users u",
    "error": "Unknown column 'u.customer_id' in 'field list'",
    "attempt": 1
  }
}
```

```jsonc
{
  "sql": "SELECT ...",                   // regenerated from the validated AST
  "dialect": "mysql",
  "attempt": 1,
  "tables": ["users", "orders"],         // what the guardrail actually saw
  "limit_applied": 1000,                 // null if the query had its own LIMIT
  "usage": { "remaining": 42, "monthly_query_limit": 100 }
}
```

### `POST /v1/validate`

Runs the AST guardrail alone — no model call, no metering. The desktop app's
manual SQL editor uses it, so hand-written queries pass through exactly the
same guardrail as generated ones and the editor can't be used to route
around it.

### There is no summarization endpoint

The spec's Step 8 (send result rows back to the model for a written summary)
is **deliberately not implemented**. It was built and then removed: it was
the only thing in the system that would have carried real customer rows off
the operator's machine, and a written paraphrase is not worth trading the
isolation guarantee for. `tests/test_no_row_data.py` asserts that no route
here accepts rows, so it can't come back by accident.

### Errors

Every failure returns the same shape, with a stable `code` the client
branches on:

```jsonc
{ "error": "human-readable message", "code": "SECURITY_VIOLATION", "details": { ... } }
```

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | Payload failed validation |
| `INVALID_API_TOKEN` | 401 | Missing/invalid `api_token` |
| `SUBSCRIPTION_REQUIRED` | 402 | No subscription attached to the account |
| `SECURITY_VIOLATION` | 422 | AST guardrail rejected the query |
| `QUESTION_UNANSWERABLE` | 422 | The blueprint can't answer the question |
| `QUERY_LIMIT_EXCEEDED` | 429 | Monthly allowance spent, or repair ceiling hit |
| `TRANSLATION_FAILED` | 502 | Model output wasn't usable SQL |
| `LLM_UNAVAILABLE` / `CONTROL_PLANE_UNAVAILABLE` | 503 | Upstream dependency down |

## Architecture notes

- **No customer row data ever reaches this tier.** The only
  database-derived content it receives is empty `CREATE TABLE` structure,
  already pruned client-side to the tables one question needs. There is no
  endpoint that accepts results, and nothing here is persisted.
- **The guardrail is structural, not textual** (`app/services/guardrail.py`).
  The model's output is compiled into a SQLGlot expression tree; the root
  must be a `Select`, and every node in the tree is walked for mutating or
  unsafe operations. A substring denylist would be defeated by casing,
  comments, or a literal containing the word "DROP" — a tree walk is not.
  Beyond the DDL/DML classes the spec calls out, the walk also rejects
  stacked statements, `SELECT ... INTO OUTFILE`, `FOR UPDATE` row locks, and
  filesystem/DoS/sequence functions (`LOAD_FILE`, `pg_read_file`, `pg_sleep`,
  `nextval`, ...) that parse as ordinary calls inside a legal `SELECT`.
- **The returned SQL is regenerated from the validated AST**, not echoed from
  the model, and comments are stripped. That last part is not cosmetic: MySQL
  executes `/*!12345 ... */` as real SQL, so a payload hidden in a "comment"
  would otherwise survive inspection and reach the server.
- **A top-level `UNION` is rejected** because the spec requires a `SELECT`
  root node. The translator prompt tells the model to wrap set operations in
  an outer query (`SELECT * FROM (a UNION b) t`), which is allowed.
- **Prompt and guardrail are separate layers.** The system instruction in
  `app/services/prompts.py` is the ergonomic layer — it makes correct output
  likely. The guardrail is the security layer — it makes incorrect output
  impossible to return. Never treat the prompt as a control.
- **Metering happens before the model call** (FR-3.2), so a user at their cap
  never reaches the paid pipeline. Self-heal retries are *not* metered:
  they fix the model's own mistake, and billing three queries for one
  question would charge the user for our error. The `MAX_REPAIR_ATTEMPTS`
  ceiling is enforced server-side, not just in the client's loop counter.
- **A 401 from the control plane is reported as 503, not 401.** It means our
  `X-Internal-Secret` was rejected — a gateway misconfiguration. Surfacing it
  as an auth error would send the operator chasing their own `api_token`.
- **The provider is swappable** (`LLM_PROVIDER=gemini|groq`). Translation is
  a small, well-specified task, and the guardrail — which is what actually
  keeps the system safe — doesn't care who produced the string. Both engines
  satisfy the same `SynthesisEngine` protocol, share the same prompts, and
  pin temperature to 0.
  **Groq is the pragmatic choice for development**: its free tier allows
  thousands of requests per day, where Gemini's allows roughly 20 *per model
  per day*, which a single afternoon of testing exhausts.
- **Model choice**: the spec names `gemini-2.5-flash`, but Google has closed
  that model to new API keys (it 404s with "no longer available to new
  users"), so the default is the current Flash generation. Temperature stays
  pinned at 0.0 per spec. Thinking is dialed down — Gemini 3.x via
  `thinking_level`, Gemini 2.5 via `thinking_budget`; each generation rejects
  the other's field, so exactly one is sent.
