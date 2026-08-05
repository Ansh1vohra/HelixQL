import type { Dialect } from "../shared/types";
import { getEndpoints } from "./config";
import { AppError } from "./errors";
import { requireApiToken } from "./session";

/**
 * Client for the FastAPI gateway (Step 4.4).
 *
 * Runs in the main process, never the renderer, so the api_token stays out
 * of the web layer.
 *
 * Note what is *not* in any payload below: no host, no port, no username, no
 * password, and — critically — not a single row of data. The only
 * database-derived content that crosses this boundary is empty CREATE TABLE
 * structure. There is deliberately no endpoint here that accepts results.
 */

export interface TranslateResponse {
  sql: string;
  dialect: Dialect;
  attempt: number;
  tables: string[];
  limit_applied: number | null;
  usage: { remaining: number; monthly_query_limit: number } | null;
}

export interface ValidateResponse {
  sql: string;
  tables: string[];
  limit_applied: number | null;
}

interface GatewayErrorBody {
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const { gatewayUrl } = getEndpoints();

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Token": requireApiToken(),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "GATEWAY_UNREACHABLE",
      `Could not reach the HelixQL gateway at ${gatewayUrl}. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GatewayErrorBody;
    // Preserve the gateway's own code so the UI can distinguish a guardrail
    // rejection from a spent quota from an upstream outage.
    throw new AppError(body.code ?? `HTTP_${response.status}`, body.error ?? `Gateway returned ${response.status}.`);
  }

  return (await response.json()) as T;
}

export interface TranslateOptions {
  question: string;
  schemaDdl: string[];
  dialect: Dialect;
  repair?: { sql: string; error: string; attempt: number };
}

export function translate(options: TranslateOptions): Promise<TranslateResponse> {
  return post<TranslateResponse>("/v1/translate", {
    question: options.question,
    schema_ddl: options.schemaDdl,
    dialect: options.dialect,
    repair: options.repair ?? null,
  });
}

/**
 * Runs hand-written SQL through the same AST guardrail that vets generated
 * SQL, so the manual editor can't be used to route around it. No model call
 * and no metering — only the query text crosses the wire.
 */
export function validate(sql: string, dialect: Dialect): Promise<ValidateResponse> {
  return post<ValidateResponse>("/v1/validate", { sql, dialect });
}
