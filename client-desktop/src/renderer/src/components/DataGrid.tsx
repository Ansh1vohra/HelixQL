import type { ResultGrid } from "../../../shared/types";
import { EmptyState } from "./ui";

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * The data half of the bifurcated dashboard (FR-2.6). Sticky headers and a
 * monospace numeric column keep a wide result set readable while scrolling.
 */
export function DataGrid({ grid, emptyMessage }: { grid: ResultGrid; emptyMessage: string }): JSX.Element {
  if (grid.columns.length === 0) {
    return <EmptyState>{emptyMessage}</EmptyState>;
  }

  return (
    <table className="w-full border-collapse text-left text-xs">
      <thead className="sticky top-0 z-10 bg-slate-900">
        <tr>
          <th className="border-b border-slate-800 px-3 py-2 font-medium text-slate-600">#</th>
          {grid.columns.map((column) => (
            <th
              key={column}
              className="whitespace-nowrap border-b border-slate-800 px-3 py-2 font-semibold text-slate-300"
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((row, index) => (
          <tr key={index} className="hover:bg-slate-800/40">
            <td className="border-b border-slate-800/60 px-3 py-1.5 font-mono text-[10px] text-slate-600">
              {index + 1}
            </td>
            {grid.columns.map((column) => {
              const value = row[column];
              return (
                <td
                  key={column}
                  className={`max-w-xs truncate border-b border-slate-800/60 px-3 py-1.5 ${
                    value === null || value === undefined
                      ? "italic text-slate-600"
                      : typeof value === "number"
                        ? "font-mono text-brand-300"
                        : "text-slate-200"
                  }`}
                  title={renderCell(value)}
                >
                  {renderCell(value)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
