import { BrowserWindow, ipcMain } from "electron";
import type {
  ConnectionConfig,
  ConnectionStatus,
  EndpointConfig,
  PipelineEvent,
  PipelineRequest,
  PipelineResult,
  SchemaBlueprint,
  SessionInfo,
  SqlRequest,
} from "../shared/types";
import { getEndpoints, setEndpoints } from "./config";
import * as connection from "./db/connection";
import { handled } from "./errors";
import { runPipeline, runSql } from "./pipeline";
import * as session from "./session";

export const IPC = {
  authLogin: "auth:login",
  authLogout: "auth:logout",
  authSession: "auth:session",
  endpointsGet: "endpoints:get",
  endpointsSet: "endpoints:set",
  dbConnect: "db:connect",
  dbDisconnect: "db:disconnect",
  dbStatus: "db:status",
  dbSchema: "db:schema",
  dbRefreshSchema: "db:refresh-schema",
  pipelineRun: "pipeline:run",
  pipelineRunSql: "pipeline:run-sql",
  pipelineEvent: "pipeline:event",
} as const;

/**
 * The complete surface the renderer can reach. Every capability the UI has
 * is one of these handlers — there is no direct database, filesystem, or
 * network access from the web layer (Step 4.2).
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.authLogin, (_event, credentials: { email: string; password: string }) =>
    handled<SessionInfo>(() => session.login(credentials.email, credentials.password)),
  );

  ipcMain.handle(IPC.authLogout, () =>
    handled<null>(async () => {
      session.logout();
      await connection.disconnect();
      return null;
    }),
  );

  ipcMain.handle(IPC.authSession, () => handled<SessionInfo | null>(async () => session.getSession()));

  ipcMain.handle(IPC.endpointsGet, () => handled<EndpointConfig>(async () => getEndpoints()));

  ipcMain.handle(IPC.endpointsSet, (_event, next: Partial<EndpointConfig>) =>
    handled<EndpointConfig>(async () => setEndpoints(next)),
  );

  ipcMain.handle(IPC.dbConnect, (_event, config: ConnectionConfig) =>
    handled<ConnectionStatus>(() => connection.connect(config)),
  );

  ipcMain.handle(IPC.dbDisconnect, () => handled<ConnectionStatus>(() => connection.disconnect()));

  ipcMain.handle(IPC.dbStatus, () => handled<ConnectionStatus>(async () => connection.status()));

  ipcMain.handle(IPC.dbSchema, () => handled<SchemaBlueprint>(async () => connection.getBlueprint()));

  ipcMain.handle(IPC.dbRefreshSchema, () => handled<ConnectionStatus>(() => connection.refreshSchema()));

  // Progress is pushed back to the window that asked, so a run narrates
  // itself instead of the UI staring at a spinner for several seconds.
  function emitterFor(event: Electron.IpcMainInvokeEvent): (payload: PipelineEvent) => void {
    const sender = BrowserWindow.fromWebContents(event.sender);
    return (payload: PipelineEvent): void => {
      if (sender && !sender.isDestroyed()) {
        sender.webContents.send(IPC.pipelineEvent, payload);
      }
    };
  }

  ipcMain.handle(IPC.pipelineRun, (event, request: PipelineRequest) =>
    handled<PipelineResult>(() => runPipeline(request, emitterFor(event))),
  );

  ipcMain.handle(IPC.pipelineRunSql, (event, request: SqlRequest) =>
    handled<PipelineResult>(() => runSql(request.sql, emitterFor(event))),
  );
}
