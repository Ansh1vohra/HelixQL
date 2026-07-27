import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// Phase 4 extends this with the actual renderer-facing API (connect,
// runQuery, etc.) backed by ipcRenderer.invoke calls into the main process.
const api = {};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // Only reached if contextIsolation is ever disabled, which this app does
  // not do — kept solely to match the upstream electron-toolkit template.
  // @ts-expect-error window typing is augmented in index.d.ts
  window.electron = electronAPI;
  // @ts-expect-error window typing is augmented in index.d.ts
  window.api = api;
}
