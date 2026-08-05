import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    // Deliberately NOT externalizeDepsPlugin(): the preload runs with
    // `sandbox: true`, where `require()` resolves only Electron's own
    // built-ins. Any externalized dependency becomes a bare require that
    // fails at load time, taking the whole bridge down with it and leaving
    // the renderer with no `window.api` — a blank window and a confusing
    // "Cannot read properties of undefined" in the console.
    // Bundling everything except `electron` itself keeps the sandbox on.
    build: {
      rollupOptions: {
        external: ["electron"],
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
    plugins: [react()],
  },
});
