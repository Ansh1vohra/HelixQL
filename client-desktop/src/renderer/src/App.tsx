function App(): JSX.Element {
  const versions = window.electron?.process?.versions;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 text-white">
      <div className="mb-2 text-2xl font-bold tracking-tight text-brand-400">HelixQL</div>
      <p className="text-sm text-slate-400">Desktop client scaffold — Phase 2</p>

      {versions && (
        <div className="mt-6 flex gap-4 text-xs text-slate-500">
          <span>Electron {versions.electron}</span>
          <span>Chromium {versions.chrome}</span>
          <span>Node {versions.node}</span>
        </div>
      )}

      <p className="mt-8 max-w-sm text-center text-xs text-slate-600">
        Database connection UI, schema introspection, and the query pipeline are wired in during Phase 4.
      </p>
    </div>
  );
}

export default App;
