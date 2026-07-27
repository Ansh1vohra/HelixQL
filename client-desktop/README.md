# HelixQL Desktop

The native admin client (Electron + Vite + React + Tailwind CSS). Runs
inside the customer's firewall: holds database credentials in memory only,
introspects the local schema, and is the only tier that ever touches real
row data. See `/HelixQL.pdf` at the repo root for the full spec.

Scaffolded in Phase 2; the connection UI, schema introspection, and query
pipeline are built in Phase 4.

## Local development

```bash
npm install
npm run dev
```

## Security notes

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the
  renderer's `BrowserWindow` — the renderer never gets direct Node/OS
  access. All database connectivity is brokered through the preload
  bridge + main-process IPC handlers (Phase 4), never the renderer
  directly.
- A strict `Content-Security-Policy` is set in `src/renderer/index.html`.
