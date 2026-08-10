import { useEffect, useState } from "react";
import type { SessionInfo } from "../../shared/types";
import { Dashboard } from "./components/Dashboard";
import { LoginScreen } from "./components/LoginScreen";
import { unwrap } from "./lib/ipc";

/**
 * Shown when the preload script did not run. Without this, every call into
 * `window.api` throws "Cannot read properties of undefined", React unmounts
 * the tree, and the window goes blank with the real cause buried in a
 * console nobody has open.
 */
function BridgeMissing(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-8">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-sm font-semibold text-red-600">The IPC bridge failed to load</h1>
        <p className="text-xs leading-relaxed text-slate-500">
          The preload script did not run, so this window has no way to reach the database or the
          HelixQL services. Check the terminal for a preload error — a dependency that cannot be
          bundled into the sandboxed preload is the usual cause.
        </p>
      </div>
    </div>
  );
}

function App(): JSX.Element {
  const bridgeReady = Boolean(window.api);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checking, setChecking] = useState(bridgeReady);

  useEffect(() => {
    if (!bridgeReady) return;
    // The session lives in the main process, so a renderer reload (or a
    // dev-server hot restart) shouldn't force a fresh sign-in.
    unwrap(window.api.auth.session())
      .then(setSession)
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [bridgeReady]);

  if (!bridgeReady) return <BridgeMissing />;

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center bg-white text-xs text-slate-400" />;
  }

  return session ? (
    <Dashboard session={session} onSignOut={() => setSession(null)} />
  ) : (
    <LoginScreen onSignedIn={setSession} />
  );
}

export default App;
