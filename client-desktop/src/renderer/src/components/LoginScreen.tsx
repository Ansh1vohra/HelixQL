import { useEffect, useState } from "react";
import type { EndpointConfig, SessionInfo } from "../../../shared/types";
import { errorMessage, unwrap } from "../lib/ipc";
import { Banner, Button, Field } from "./ui";

/**
 * Secure desktop login (Step 4.1 / FR-2.2).
 *
 * Credentials go to the control plane, which returns the account's
 * api_token. The token is cached in the main process and never reaches this
 * component — the UI only learns the user's name and email.
 */
export function LoginScreen({ onSignedIn }: { onSignedIn: (session: SessionInfo) => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEndpoints, setShowEndpoints] = useState(false);
  const [endpoints, setEndpointsState] = useState<EndpointConfig>({ controlPlaneUrl: "", gatewayUrl: "" });

  useEffect(() => {
    unwrap(window.api.endpoints.get()).then(setEndpointsState).catch(() => undefined);
  }, []);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await unwrap(window.api.endpoints.set(endpoints));
      const session = await unwrap(window.api.auth.login({ email, password }));
      onSignedIn(session);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-brand-400">HelixQL</h1>
          <p className="mt-1 text-xs text-slate-500">Sign in with your HelixQL account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@company.com"
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••"
          />

          {error && <Banner tone="error" title="Sign-in failed">{error}</Banner>}

          <Button type="submit" disabled={busy || !email || !password} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => setShowEndpoints((open) => !open)}
            className="text-[11px] text-slate-500 transition hover:text-slate-300"
          >
            {showEndpoints ? "− Hide" : "+ Show"} server settings
          </button>

          {showEndpoints && (
            <div className="mt-3 space-y-3">
              <Field
                label="Account service"
                value={endpoints.controlPlaneUrl}
                onChange={(e) => setEndpointsState((s) => ({ ...s, controlPlaneUrl: e.target.value }))}
              />
              <Field
                label="Gateway"
                value={endpoints.gatewayUrl}
                onChange={(e) => setEndpointsState((s) => ({ ...s, gatewayUrl: e.target.value }))}
                hint="Point these at your own deployment if you self-host."
              />
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-600">
          Database credentials are entered after sign-in and never leave this machine.
        </p>
      </div>
    </div>
  );
}
