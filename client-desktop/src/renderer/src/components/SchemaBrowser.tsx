import { useEffect, useMemo, useState } from "react";
import type { SchemaBlueprint, TableInfo } from "../../../shared/types";
import { unwrap } from "../lib/ipc";
import { EmptyState } from "./ui";

/**
 * The schema browser any database client is expected to have: what tables
 * exist, what columns they hold, which are keys.
 *
 * Reads the blueprint already cached in the main process from the Step 1
 * catalog sweep, so opening it costs no round trip to the database.
 */
export function SchemaBrowser({
  refreshKey,
  onViewData,
}: {
  refreshKey: number;
  /** Called from a table's right-click menu to show that table's rows. */
  onViewData: (table: string, dialect: SchemaBlueprint["dialect"]) => void;
}): JSX.Element {
  const [blueprint, setBlueprint] = useState<SchemaBlueprint | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ table: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    // Any click, scroll, resize or Escape dismisses the menu, the way a
    // native context menu behaves.
    const close = (): void => setMenu(null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    unwrap(window.api.db.schema())
      .then(setBlueprint)
      .catch(() => setBlueprint(null));
  }, [refreshKey]);

  const tables = useMemo(() => {
    if (!blueprint) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return blueprint.tables;
    // Match on column names too — "which table has the email?" is the
    // question a schema browser most often has to answer.
    return blueprint.tables.filter(
      (table) =>
        table.name.toLowerCase().includes(needle) ||
        table.columns.some((column) => column.name.toLowerCase().includes(needle)),
    );
  }, [blueprint, filter]);

  if (!blueprint) {
    return <EmptyState>Connect to a database to browse its tables.</EmptyState>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-slate-200 p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tables and columns…"
          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tables.length === 0 ? (
          <EmptyState>No table or column matches “{filter}”.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200">
            {tables.map((table) => (
              <TableRow
                key={table.name}
                table={table}
                open={expanded === table.name}
                onToggle={() => setExpanded(expanded === table.name ? null : table.name)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ table: table.name, x: event.clientX, y: event.clientY });
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-400">
        {blueprint.tables.length} tables · {blueprint.database} · mapped{" "}
        {new Date(blueprint.capturedAt).toLocaleTimeString()}
      </div>

      {menu && (
        <div
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 min-w-36 rounded border border-slate-200 bg-white py-1 text-xs shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onViewData(menu.table, blueprint.dialect);
              setMenu(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-brand-50 hover:text-brand-700"
          >
            View data
          </button>
        </div>
      )}
    </div>
  );
}

function TableRow({
  table,
  open,
  onToggle,
  onContextMenu,
}: {
  table: TableInfo;
  open: boolean;
  onToggle: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}): JSX.Element {
  const foreignKeyFor = (column: string): string | null => {
    const fk = table.foreignKeys.find((candidate) => candidate.column === column);
    return fk ? `${fk.referencesTable}.${fk.referencesColumn}` : null;
  };

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        onContextMenu={onContextMenu}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left transition hover:bg-slate-100"
      >
        <span className="flex items-center gap-1.5 font-mono text-xs text-slate-800">
          <span className="text-slate-400">{open ? "▾" : "▸"}</span>
          {table.name}
        </span>
        <span className="text-[10px] text-slate-400">{table.columns.length}</span>
      </button>

      {open && (
        <ul className="bg-slate-50 pb-1.5 pl-7 pr-3">
          {table.columns.map((column) => {
            const references = foreignKeyFor(column.name);
            return (
              <li key={column.name} className="flex items-baseline justify-between gap-2 py-0.5">
                <span className="truncate font-mono text-[11px] text-slate-600">
                  {column.isPrimaryKey && <span className="mr-1 text-amber-600" title="Primary key">PK</span>}
                  {references && (
                    <span className="mr-1 text-brand-600" title={`References ${references}`}>
                      FK
                    </span>
                  )}
                  {column.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  {column.dataType}
                  {!column.nullable && " ·not null"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
