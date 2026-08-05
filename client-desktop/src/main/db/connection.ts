import type { ConnectionConfig, ConnectionStatus, SchemaBlueprint } from "../../shared/types";
import { AppError } from "../errors";
import { createDriver, type Driver } from "./driver";

interface ActiveConnection {
  config: ConnectionConfig;
  driver: Driver;
  blueprint: SchemaBlueprint;
}

/**
 * Module-level, in-memory only (FR-2.4).
 *
 * Credentials are never written to disk, never sent to the renderer, and
 * never included in a gateway request. Closing the app is what "logging
 * out" of the database means — there is nothing persisted to clear.
 */
let active: ActiveConnection | null = null;

function normalizeDriverError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error);

  // The driver's own text is the most useful thing we can show an admin
  // debugging a firewall or a typo'd host, so it is preserved verbatim.
  return new AppError("DB_CONNECTION_FAILED", message);
}

/**
 * Opens the pool and sweeps the system catalog once (Step 1), caching the
 * structural blueprint for the session. Re-sweeping per query would add a
 * round trip to every question for a layout that rarely changes mid-session.
 */
export async function connect(config: ConnectionConfig): Promise<ConnectionStatus> {
  await disconnect();

  let driver: Driver;
  try {
    driver = await createDriver(config);
  } catch (error) {
    throw normalizeDriverError(error);
  }

  try {
    const tables = await driver.introspect();
    active = {
      config,
      driver,
      blueprint: {
        dialect: config.dialect,
        database: config.database,
        tables,
        capturedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    await driver.close().catch(() => undefined);
    throw new AppError(
      "SCHEMA_INTROSPECTION_FAILED",
      `Connected, but could not read the schema catalog: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return status();
}

export async function refreshSchema(): Promise<ConnectionStatus> {
  const current = requireActive();
  const tables = await current.driver.introspect();
  current.blueprint = {
    ...current.blueprint,
    tables,
    capturedAt: new Date().toISOString(),
  };
  return status();
}

export function requireActive(): ActiveConnection {
  if (!active) {
    throw new AppError("NOT_CONNECTED", "Connect to a database before running a query.");
  }
  return active;
}

export function getBlueprint(): SchemaBlueprint {
  return requireActive().blueprint;
}

export function status(): ConnectionStatus {
  if (!active) return { connected: false };

  // Note the omission: no password field. The renderer is shown what it
  // needs to display a connection banner and nothing more.
  return {
    connected: true,
    dialect: active.config.dialect,
    database: active.config.database,
    host: active.config.host,
    port: active.config.port,
    user: active.config.user,
    tableCount: active.blueprint.tables.length,
    capturedAt: active.blueprint.capturedAt,
  };
}

export async function disconnect(): Promise<ConnectionStatus> {
  if (active) {
    await active.driver.close().catch(() => undefined);
    active = null;
  }
  return { connected: false };
}
