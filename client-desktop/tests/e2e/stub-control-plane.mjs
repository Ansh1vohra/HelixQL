/**
 * Minimal stand-in for the Next.js control plane, for end-to-end runs.
 *
 * Implements only the three routes the data plane actually depends on:
 * desktop sign-in, gateway token verification, and usage metering. Using
 * this instead of the real control plane keeps an e2e run from needing
 * MongoDB, SMTP, and a Next.js server just to prove the query pipeline
 * works — those routes have their own Vitest suite in `control-plane/`.
 *
 *   node tests/e2e/stub-control-plane.mjs
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 3999);
const INTERNAL_SECRET = process.env.STUB_INTERNAL_SECRET ?? "e2e-internal-secret";
const API_TOKEN = process.env.STUB_API_TOKEN ?? "hql_live_e2e_token";
const USER = { name: "E2E Admin", email: "e2e@example.com" };
const PASSWORD = "e2e-password";

const usage = { used: 0, limit: 100 };

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const body = await readJson(req);

  if (req.url === "/api/auth/login") {
    if (body.email === USER.email && body.password === PASSWORD) {
      return send(res, 200, { user: USER, apiToken: API_TOKEN });
    }
    return send(res, 401, { error: "Incorrect email or password." });
  }

  // The internal routes are secret-guarded exactly as the real ones are.
  if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) {
    return send(res, 401, { error: "Unauthorized" });
  }

  if (req.url === "/api/internal/tokens/verify") {
    return body.apiToken === API_TOKEN
      ? send(res, 200, { valid: true, userId: "e2e-user" })
      : send(res, 403, { valid: false });
  }

  if (req.url === "/api/internal/usage/increment") {
    if (usage.used >= usage.limit) {
      return send(res, 429, { allowed: false, error: "Monthly query allowance exceeded for this plan." });
    }
    usage.used += 1;
    return send(res, 200, { allowed: true, remaining: usage.limit - usage.used, monthlyQueryLimit: usage.limit });
  }

  return send(res, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`stub control plane listening on http://127.0.0.1:${PORT}`);
});
