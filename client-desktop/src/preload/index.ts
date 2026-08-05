import { contextBridge, ipcRenderer } from "electron";
import type {
  ConnectionConfig,
  ConnectionStatus,
  EndpointConfig,
  HelixApi,
  IpcResult,
  PipelineEvent,
  PipelineRequest,
  PipelineResult,
  SchemaBlueprint,
  SessionInfo,
  SqlRequest,
} from "../shared/types";

/**
 * The isolated IPC bridge (Step 4.2).
 *
 * This is an explicit allowlist, not a passthrough: the renderer gets these
 * named operations and nothing else. It cannot reach `ipcRenderer` directly,
 * cannot open a database socket, and cannot read the cached api_token —
 * that stays in the main process.
 */
const api: HelixApi = {
  auth: {
    login: (credentials: { email: string; password: string }): Promise<IpcResult<SessionInfo>> =>
      ipcRenderer.invoke("auth:login", credentials),
    logout: (): Promise<IpcResult<null>> => ipcRenderer.invoke("auth:logout"),
    session: (): Promise<IpcResult<SessionInfo | null>> => ipcRenderer.invoke("auth:session"),
  },
  endpoints: {
    get: (): Promise<IpcResult<EndpointConfig>> => ipcRenderer.invoke("endpoints:get"),
    set: (next: Partial<EndpointConfig>): Promise<IpcResult<EndpointConfig>> =>
      ipcRenderer.invoke("endpoints:set", next),
  },
  db: {
    connect: (config: ConnectionConfig): Promise<IpcResult<ConnectionStatus>> =>
      ipcRenderer.invoke("db:connect", config),
    disconnect: (): Promise<IpcResult<ConnectionStatus>> => ipcRenderer.invoke("db:disconnect"),
    status: (): Promise<IpcResult<ConnectionStatus>> => ipcRenderer.invoke("db:status"),
    schema: (): Promise<IpcResult<SchemaBlueprint>> => ipcRenderer.invoke("db:schema"),
    refreshSchema: (): Promise<IpcResult<ConnectionStatus>> => ipcRenderer.invoke("db:refresh-schema"),
  },
  pipeline: {
    run: (request: PipelineRequest): Promise<IpcResult<PipelineResult>> =>
      ipcRenderer.invoke("pipeline:run", request),
    runSql: (request: SqlRequest): Promise<IpcResult<PipelineResult>> =>
      ipcRenderer.invoke("pipeline:run-sql", request),
    /** Subscribe to progress events; returns an unsubscribe function so a
     * remounting React component can't leak listeners. */
    onEvent: (callback: (event: PipelineEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: PipelineEvent): void => callback(payload);
      ipcRenderer.on("pipeline:event", listener);
      return () => {
        ipcRenderer.removeListener("pipeline:event", listener);
      };
    },
  },
};

if (process.contextIsolated) {
  try {
    // Only our own allowlist is exposed. The electron-toolkit `electronAPI`
    // helper the template ships is not: nothing in the UI used it, and it
    // widens what the web layer can reach for no benefit.
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // The upstream template falls back to assigning onto `window` here. We
  // refuse instead: without context isolation, that assignment would hand
  // page scripts a direct handle to the database bridge. Failing loudly
  // with an unusable app is the correct outcome for a misconfiguration
  // this severe.
  console.error(
    "HelixQL: contextIsolation is disabled. Refusing to expose the IPC bridge — check webPreferences in the main process.",
  );
}
