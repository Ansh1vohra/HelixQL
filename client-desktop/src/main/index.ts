import { join } from "path";
import { app, shell, BrowserWindow } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { registerIpcHandlers } from "./ipc";
import { disconnect } from "./db/connection";

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // Security: renderer never gets direct Node/OS access. All database
      // connectivity is brokered through the preload bridge + main process
      // IPC handlers (built in Phase 4), never the renderer directly.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.helixql.desktop");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  registerIpcHandlers();
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Close database sockets cleanly on quit. Credentials and the api_token
// live in process memory only, so exiting is all it takes to clear them —
// there is nothing on disk to wipe.
app.on("before-quit", () => {
  void disconnect();
});
