import { useState } from "react";
import type { ConnectionConfig, ConnectionStatus, Dialect } from "../../../shared/types";
import { errorMessage, unwrap } from "../lib/ipc";
import { Banner, Button, Field, Select } from "./ui";

const DEFAULT_PORTS: Record<Dialect, number> = { mysql: 3306, postgres: 5432 };

/**
 * Local connection string isolation (Step 4.5 / FR-2.4).
 *
 * These fields are sent over IPC to the main process and held in memory
 * there for the session. Nothing is written to disk and nothing is included
 * in any cloud request.
 */
export function ConnectionPanel({
  status,
  onStatusChange,
}: {
  status: ConnectionStatus;
  onStatusChange: (status: ConnectionStatus) => void;
}): JSX.Element {
  const [form, setForm] = useState<ConnectionConfig>({
    dialect: "mysql",
    host: "localhost",
    port: DEFAULT_PORTS.mysql,
    database: "",
    user: "",
    password: "",
    ssl: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update<K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]): void {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // Follow the dialect's default port unless the admin has typed their
      // own — switching engines with a stale port is a confusing failure.
      if (key === "dialect" && current.port === DEFAULT_PORTS[current.dialect]) {
        next.port = DEFAULT_PORTS[value as Dialect];
      }
      return next;
    });
  }

  async function handleConnect(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onStatusChange(await unwrap(window.api.db.connect(form)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    setBusy(true);
    try {
      onStatusChange(await unwrap(window.api.db.disconnect()));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onStatusChange(await unwrap(window.api.db.refreshSchema()));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (status.connected) {
    return (
      <div className="space-y-3 p-4">
        <Banner tone="success" title={`Connected to ${status.database}`}>
          <div className="space-y-0.5 font-mono">
            <div>
              {status.dialect} · {status.host}:{status.port} · {status.user}
            </div>
            <div>
              {status.tableCount} tables mapped
              {status.capturedAt && ` at ${new Date(status.capturedAt).toLocaleTimeString()}`}
            </div>
          </div>
        </Banner>

        {error && <Banner tone="error" title="Schema refresh failed">{error}</Banner>}

        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleRefresh} disabled={busy}>
            Refresh schema
          </Button>
          <Button variant="danger" onClick={handleDisconnect} disabled={busy}>
            Disconnect
          </Button>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-400">
          Credentials are held in this app&apos;s memory only. They are never written to disk and never sent to
          HelixQL&apos;s servers.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleConnect} className="space-y-3 p-4">
      <Select label="Engine" value={form.dialect} onChange={(e) => update("dialect", e.target.value as Dialect)}>
        <option value="mysql">MySQL / MariaDB</option>
        <option value="postgres">PostgreSQL</option>
      </Select>

      <div className="grid grid-cols-[1fr,90px] gap-2">
        <Field label="Host" required value={form.host} onChange={(e) => update("host", e.target.value)} />
        <Field
          label="Port"
          type="number"
          required
          value={form.port}
          onChange={(e) => update("port", Number(e.target.value))}
        />
      </div>

      <Field label="Database" required value={form.database} onChange={(e) => update("database", e.target.value)} />
      <Field label="User" required value={form.user} onChange={(e) => update("user", e.target.value)} />
      <Field
        label="Password"
        type="password"
        value={form.password}
        onChange={(e) => update("password", e.target.value)}
        hint="Use a read-only database account for the tightest setup."
      />

      <label className="flex items-center gap-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={form.ssl}
          onChange={(e) => update("ssl", e.target.checked)}
          className="rounded border-slate-300 bg-white"
        />
        Use SSL/TLS
      </label>

      {error && <Banner tone="error" title="Connection failed">{error}</Banner>}

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Connecting…" : "Connect & map schema"}
      </Button>
    </form>
  );
}
