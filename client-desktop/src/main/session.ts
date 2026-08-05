import type { SessionInfo } from "../shared/types";
import { getEndpoints } from "./config";
import { AppError } from "./errors";

/**
 * Secure token caching (Step 4.1 / FR-2.3).
 *
 * The api_token lives here — in main-process memory, for the lifetime of
 * the process. It is never written to disk and, deliberately, never crosses
 * the bridge to the renderer: the UI has no legitimate use for it, and
 * keeping it out of the web layer means an XSS-style bug in the renderer
 * has nothing to steal. Every gateway call is made from this process.
 */
let apiToken: string | null = null;
let session: SessionInfo | null = null;

interface LoginResponse {
  user?: { name?: string; email?: string };
  apiToken?: string;
  error?: string;
}

export async function login(email: string, password: string): Promise<SessionInfo> {
  const { controlPlaneUrl } = getEndpoints();

  let response: Response;
  try {
    response = await fetch(`${controlPlaneUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    throw new AppError(
      "CONTROL_PLANE_UNREACHABLE",
      `Could not reach the HelixQL account service at ${controlPlaneUrl}. ${
        error instanceof Error ? error.message : ""
      }`.trim(),
    );
  }

  const body = (await response.json().catch(() => ({}))) as LoginResponse;

  if (!response.ok) {
    const code =
      response.status === 401 ? "INVALID_CREDENTIALS" : response.status === 429 ? "RATE_LIMITED" : "LOGIN_FAILED";
    throw new AppError(code, body.error ?? "Sign-in failed. Check your email and password.");
  }

  if (!body.apiToken) {
    // The control plane mints the token at email-verification time, so a
    // missing one means the account never completed activation.
    throw new AppError(
      "NO_API_TOKEN",
      "This account has no api_token yet. Verify your email from the HelixQL website, then sign in again.",
    );
  }

  apiToken = body.apiToken;
  session = { name: body.user?.name ?? "", email: body.user?.email ?? email };
  return session;
}

export function requireApiToken(): string {
  if (!apiToken) {
    throw new AppError("NOT_SIGNED_IN", "Sign in to your HelixQL account before running a query.");
  }
  return apiToken;
}

export function getSession(): SessionInfo | null {
  return session;
}

export function logout(): void {
  apiToken = null;
  session = null;
}
