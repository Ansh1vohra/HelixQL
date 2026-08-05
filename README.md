# HelixQL

Ask a database questions in English, without the data ever leaving your
machine. See `HelixQL.pdf` for the full product spec.

Three tiers:

| Directory | What it is | Runs on |
| --- | --- | --- |
| [`control-plane/`](control-plane) | Next.js + MongoDB. Accounts, email verification, `api_token` issuance, subscription and usage tracking. | `:3000` |
| [`server-gateway/`](server-gateway) | Python FastAPI. Translates English → SQL via Gemini and enforces the SQLGlot AST guardrail. Holds the model credentials. | `:8000` |
| [`client-desktop/`](client-desktop) | Electron + React. Runs inside your firewall. The only tier that touches real data. | desktop app |

**The privacy claim, concretely:** the gateway receives an English question
plus empty `CREATE TABLE` structure for the few tables that question needs.
It never receives database credentials, and it has no endpoint that accepts
result rows. Rows are read locally, held in local memory, and rendered
locally.

## Running all three locally

### One-time setup

```bash
# 1. Dependencies
cd control-plane  && npm install && cd ..
cd client-desktop && npm install && cd ..
cd server-gateway && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt && cd ..

# 2. Configuration
cp control-plane/.env.example  control-plane/.env
cp server-gateway/.env.example server-gateway/.env
```

Fill in both `.env` files. Generate each secret with `openssl rand -hex 32`.

> **The one that trips everyone up:** `GATEWAY_INTERNAL_SECRET` in
> `control-plane/.env` and `CONTROL_PLANE_INTERNAL_SECRET` in
> `server-gateway/.env` must be **byte-for-byte identical**. If they differ,
> every query fails with an opaque `CONTROL_PLANE_UNAVAILABLE`. `dev.sh`
> checks this before starting anything.

You also need a MongoDB (Atlas connection string, or `docker run -d -p
27017:27017 mongo:7`) and a `GEMINI_API_KEY` from
[aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### A database to query

If you don't already have one handy:

```bash
docker run -d --name helixql-postgres -e POSTGRES_PASSWORD=helix \
  -e POSTGRES_USER=helix -e POSTGRES_DB=shopdb -p 55432:5432 postgres:16
docker exec -i helixql-postgres psql -U helix -d shopdb < scripts/sample-db.sql
```

Port 55432 avoids colliding with a PostgreSQL already running on your host.

### Start everything

```bash
./scripts/dev.sh
```

That validates configuration, starts the control plane and gateway in the
background, waits for both to answer, then runs the desktop app in the
foreground. Closing the app (or Ctrl+C) stops all three. Server logs go to
`.dev-logs/`.

Prefer separate terminals? Three commands, same result:

```bash
cd control-plane  && npm run dev                              # :3000
cd server-gateway && ./venv/bin/uvicorn app.main:app --port 8000
cd client-desktop && npm run dev
```

## Checking that it works

**1. Create an account.** Open <http://localhost:3000>, register, and click
the verification link. Verification is what mints your `api_token` and
attaches the free plan — you cannot sign in to the desktop app before it.

If `SMTP_HOST` is blank in `control-plane/.env`, no mail is sent and the
link is printed to the control plane's console instead (`.dev-logs/control-plane.log`),
which is usually what you want locally.

**2. Sign in to the desktop app** with the same email and password. The app
calls the control plane's `/api/auth/login` and caches the returned
`api_token` in its main process.

**3. Connect to your database** in the left sidebar:

| Field | Value for the sample database |
| --- | --- |
| Engine | PostgreSQL |
| Host / Port | `localhost` / `55432` |
| Database | `shopdb` |
| User / Password | `helix` / `helix` |

It connects and maps the schema in one pass.

**4. Look around.** The **Schema** tab lists every table; expand one for
columns, types, and PK/FK markers.

**5. Ask something.** In *Ask in English*:

> Who made the most orders from Gujarat?

Expect Asha Patel. Note that Priya has more orders overall but is in
Maharashtra — so a correct answer requires the model to have joined and
filtered properly, which makes this a better check than it looks.

**6. Read the diagnostics pane**, which is the interesting part:

- the generated SQL
- the `EXPLAIN` plan (never `ANALYZE`)
- stage timings
- **exactly which table structures were sent to the gateway** — audit this;
  `payroll` should never appear for a sales question
- the self-correction trail, if the model had to fix its own query

**7. Try the guardrail.** Switch to *Write SQL* and run `DELETE FROM payroll`.
It is refused with a security violation, and no allowance is spent. The
manual editor goes through the same AST guardrail as generated SQL, so it
isn't a way around it.

**8. Watch your usage.** The header shows queries remaining. It also appears
on the web dashboard at <http://localhost:3000/dashboard>. Only English
questions are metered; hand-written SQL isn't, because no model is involved.

## Tests

```bash
cd server-gateway && ./venv/bin/python -m pytest   # 84 — guardrail, auth, metering, retries
cd control-plane  && npm test                      # 27 — auth, tokens, usage, rate limiting
cd client-desktop && npm test                      # 18 — schema pruning, DDL building
```

The desktop package also carries an end-to-end suite that drives the real
pipeline against a real database, the real gateway, and the real Gemini API.
It is skipped unless `HELIXQL_E2E=1` — see
[`client-desktop/README.md`](client-desktop/README.md#end-to-end-verification).

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `CONTROL_PLANE_UNAVAILABLE` on every query | The two shared secrets don't match. |
| Sign-in says "no api_token yet" | The account was never email-verified. |
| `LLM_UNAVAILABLE` / "translation service is busy" after a few queries | Free-tier Gemini allows only ~20 requests **per day per model**. Either set `LLM_PROVIDER=groq` with a `GROQ_API_KEY` (much larger free tier), or switch `GEMINI_MODEL` — each model has its own quota. **Restart the gateway after changing `.env`**; settings are read once at startup. |
| Gateway 400 on every translation | `GEMINI_THINKING_LEVEL` and `GEMINI_THINKING_BUDGET` are both set. Gemini 3.x takes the level, 2.5 takes the budget; set one, blank the other. |
| Desktop app exits instantly, `SIGSEGV` | Electron 39 segfaults on Ubuntu 24.04 with a 7.x kernel, before it even reaches app startup. The project is pinned to Electron 37, which works. Don't upgrade without testing on Linux. |
| Desktop app exits instantly, `TypeError: Cannot read properties of undefined (reading 'isPackaged')` | `ELECTRON_RUN_AS_NODE=1` is set in your shell. Unset it. |
| Desktop window is blank | The preload script failed to load, so `window.api` is missing. The app now detects this and says so on screen; the terminal has the underlying error. Usually a dependency that can't be bundled into the sandboxed preload — see the comment in `client-desktop/electron.vite.config.ts`. |
