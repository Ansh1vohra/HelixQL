import type { IpcError, IpcResult } from "../shared/types";

/**
 * An error with a stable code the renderer can branch on. Mirrors the
 * gateway's `{error, code}` envelope so a failure originating in the cloud
 * and one originating locally look the same to the UI.
 */
export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message, code: "UNEXPECTED_ERROR" };
  }
  return { message: String(error), code: "UNEXPECTED_ERROR" };
}

/**
 * Wraps an IPC handler so it always resolves with an `IpcResult` rather
 * than rejecting. See the note on `IpcResult`: a rejected IPC call loses
 * the error code on its way across the bridge.
 */
export async function handled<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: toIpcError(error) };
  }
}
