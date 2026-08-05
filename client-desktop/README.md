# HelixQL Desktop

The native admin client (Electron + Vite + React + Tailwind CSS). Runs
inside the customer's firewall: holds database credentials in memory only,
introspects the local schema, and is the only tier that ever touches real
row data. See `/HelixQL.pdf` at the repo root for the full spec.

## Local development

```bash
npm install
npm run dev          # requires the gateway and control plane to be running
npm run typecheck
npm run lint
npm test             # Vitest — schema pruner and DDL builder
```

The app expects the two cloud tiers at `http://localhost:3000` (control
plane) and `http://localhost:8000` (gateway). Override with
`HELIXQL_CONTROL_PLANE_URL` / `HELIXQL_GATEWAY_URL`, or from the
"server settings" disclosure on the login screen.

## What the app does

- **Connect** to MySQL/MariaDB or PostgreSQL with host/port/database/user/
  password/SSL. Credentials stay in main-process memory for the session.
- **Browse the schema** — tables, columns, types, nullability, primary and
  foreign keys, filterable by table *or* column name.
- **Ask in English** — the full translate → guardrail → EXPLAIN → execute
  pipeline, with self-healing on database errors.
- **Write SQL directly** — a manual editor for when you already know the
  query. It goes through the same AST guardrail as generated SQL, and
  consumes no query allowance because no model is involved.
- **Read results and diagnostics side by side** — the record grid on one
  side, the optimizer plan, generated SQL, stage timings, and the
  self-correction trail on the other.

## How a question becomes an answer

All of this is orchestrated by `src/main/pipeline.ts`, in the main process.

1. **Prune** (`db/rag.ts`) — the question is matched against the locally
   cached schema and reduced to the handful of tables it needs.
2. **Blueprint** (`db/ddl.ts`) — those tables are rendered as empty
   `CREATE TABLE` statements. This is the only database-derived thing that
   ever leaves the machine.
3. **Translate** (`gateway.ts`) — question + blueprint go to the gateway,
   which returns SQL that has already passed the AST guardrail.
4. **Explain** (`db/driver.ts`) — `EXPLAIN` (never `ANALYZE`) runs against
   the live database. The optimizer validates every identifier and join
   without reading a row.
5. **Self-heal** — if `EXPLAIN` errors, the broken SQL plus the driver's raw
   error go back to the gateway for correction, up to 3 attempts.
6. **Execute** — the verified query runs and rows land in local memory, and
   go straight to the local UI.

There is no step 7. The spec's final "send the rows back to the model for a
written summary" step is deliberately not implemented — see the security
note below.

## Security notes

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the
  renderer's `BrowserWindow` — the renderer never gets direct Node/OS
  access. All database connectivity is brokered through the preload bridge
  and main-process IPC handlers, never the renderer directly.
- A strict `Content-Security-Policy` is set in `src/renderer/index.html`.
  The renderer makes no network requests of its own; every HTTP call
  originates in the main process.
- **The preload bridge is an allowlist, not a passthrough** — see
  `HelixApi` in `src/shared/types.ts` for the complete set of capabilities
  the web layer has. If `contextIsolation` were ever disabled, the preload
  script refuses to expose the bridge at all rather than falling back to
  assigning onto `window`.
- **Database credentials never leave the main process.** They are held in a
  module-level variable in `db/connection.ts` for the session, never written
  to disk, never sent to the renderer (`status()` deliberately omits the
  password), and never included in a gateway payload.
- **The `api_token` never reaches the renderer either.** It is cached in
  `session.ts` and used only for main-process HTTP calls, so a scripting bug
  in the UI has nothing to steal.
- **No result row ever leaves the machine.** Rows are read from the local
  database into main-process memory and rendered locally. Nothing in
  `gateway.ts` accepts or transmits them, and the gateway has no endpoint
  that would receive them. The only database-derived content that crosses
  the network is empty `CREATE TABLE` structure for the handful of tables a
  question needs — visible in the diagnostics panel on every run, so an
  operator can audit exactly what was sent.
- **Queries execute inside a read-only transaction** (`BEGIN TRANSACTION
  READ ONLY` / `START TRANSACTION READ ONLY`), always rolled back. The
  gateway's AST guardrail is the primary control, but it runs in the cloud
  and trusts that the string it validated is the string that executes. This
  is the local backstop: the database server itself refuses a write, so a
  bug or a tampered client still cannot mutate customer data. The e2e suite
  asserts this directly.

## End-to-end verification

`tests/e2e/pipeline.e2e.test.ts` runs the real pipeline against a real
PostgreSQL, the real gateway, and the real Gemini API — nothing on the query
path is mocked. Only the control plane is stubbed, so a run doesn't need
MongoDB, SMTP, and Next.js just to prove the data plane works.

```bash
# 1. a database with some data in it
docker run -d --name helixql-e2e -e POSTGRES_PASSWORD=helix \
  -e POSTGRES_USER=helix -e POSTGRES_DB=shopdb -p 55432:5432 postgres:16
#    then create users/orders/products/payroll and seed a few rows

# 2. the stubbed control plane
node tests/e2e/stub-control-plane.mjs

# 3. the real gateway, pointed at the stub
cd ../server-gateway && CONTROL_PLANE_BASE_URL=http://127.0.0.1:3999 \
  CONTROL_PLANE_INTERNAL_SECRET=e2e-internal-secret \
  ./venv/bin/uvicorn app.main:app --port 8099

# 4. run it
HELIXQL_E2E=1 npx vitest run tests/e2e
```

Without `HELIXQL_E2E=1` the suite skips, so `npm test` stays hermetic.

To run the same suite against the **real** control plane instead of the stub
— which also exercises MongoDB-backed token verification and usage metering
— start Next.js and the gateway against it, register and verify an account,
then point the suite at it:

```bash
HELIXQL_E2E=1 E2E_CONTROL_PLANE=http://127.0.0.1:3000 \
  E2E_EMAIL=you@example.com E2E_PASSWORD='...' npx vitest run tests/e2e
```

A free-tier Gemini key allows only ~20 requests **per day per model**, and a
full run of this suite uses six. The gateway retries a 429 with backoff, but
once the daily quota is gone, backoff cannot help. If a run reports
`LLM_UNAVAILABLE`, it is quota, not code — point the gateway at a different
model, which has its own separate allowance:

```bash
GEMINI_MODEL=gemini-3.5-flash GEMINI_THINKING_LEVEL= GEMINI_THINKING_BUDGET=0 \
  ./venv/bin/uvicorn app.main:app --port 8099
```

(Gemini 2.5-era models take `thinking_budget`; 3.x takes `thinking_level`.
Set one and blank the other, or the API returns a 400.)
