import type { IpcResult } from "../../../shared/types";

export class IpcCallError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "IpcCallError";
    this.code = code;
  }
}

/**
 * Unwraps the `IpcResult` envelope into a value or a throw, so components
 * can use ordinary try/catch instead of checking `.ok` at every call site.
 * The error `code` survives, which is what the UI branches on to tell a
 * guardrail rejection apart from a spent quota.
 */
export async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call;
  if (result.ok) return result.data;
  throw new IpcCallError(result.error.message, result.error.code);
}

export function errorMessage(error: unknown): string {
  if (error instanceof IpcCallError || error instanceof Error) return error.message;
  return String(error);
}

export function errorCode(error: unknown): string {
  return error instanceof IpcCallError ? error.code : "UNEXPECTED_ERROR";
}
