# HelixQL Control Plane

The centralized web SaaS tier: account registration, email verification,
`api_token` issuance, and subscription/usage tracking for the HelixQL
gateway and desktop client. See `/HelixQL.pdf` at the repo root for the full
product/architecture spec.

## Stack

Next.js 14 (App Router, TypeScript) · MongoDB via Mongoose · `bcryptjs` ·
`jose` (session JWTs) · `nodemailer` (SMTP) · `zod` · Vitest +
`mongodb-memory-server`.

## Local development

1. `cp .env.example .env.local` and fill in the secrets. Generate each with:
   ```
   openssl rand -hex 32
   ```
2. Start a local MongoDB (e.g. `docker run -d -p 27017:27017 mongo:7`).
3. `npm install`
4. `npm run dev` — the app runs at `http://localhost:3000`.

Without `SMTP_HOST` set, verification emails are logged to the console
instead of sent — copy the verify link from the terminal during local
testing.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm run start` — production build and serve
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm test` — Vitest (unit + `mongodb-memory-server`-backed integration tests)

## Architecture notes

- **The gateway never talks to MongoDB directly.** It authenticates and
  meters usage via `POST /api/internal/tokens/verify` and
  `POST /api/internal/usage/increment`, guarded by a shared
  `GATEWAY_INTERNAL_SECRET` header (`X-Internal-Secret`). This keeps schema
  and validation logic in one place instead of duplicated across the
  TypeScript control plane and the Python gateway.
- **`api_token` is stored two ways**: an HMAC-SHA256 lookup hash (indexed,
  one-way, used to validate incoming tokens in O(1)) and an AES-256-GCM
  encrypted copy (decryptable only by this server, so the plaintext can be
  handed back to the user on login, per the desktop client's login flow).
  It is never stored or logged in plaintext.
- **Usage metering is race-safe**: period rollover and the increment-vs-limit
  check are both conditional `findOneAndUpdate` calls, so concurrent
  requests from the same user cannot exceed the monthly quota.
- **Rate limiting** on `/register` and `/login` is MongoDB-backed (fixed
  window, TTL-indexed) so it's correct across multiple serverless instances.
  If this becomes a bottleneck at scale, swap it for Upstash Redis behind
  the same `checkRateLimit` signature.
