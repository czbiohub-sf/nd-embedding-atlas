/**
 * Pure helpers for the annotate commit panel. Kept separate from the panel so the
 * union-discrimination and all-remote logic — the parts that would otherwise
 * dereference `columns`/`format` on an error member and crash — are unit-testable
 * without a React DOM harness (this repo has none).
 */

import type { CommitAnnotationsResponse, CommitDatasetReport } from "@/types";

export interface DatasetRow {
  datasetKey: string;
  path?: string;
  /** null when writable; a message when this dataset can't be written (remote / no source / thrown). */
  error: string | null;
  format?: "v2" | "v3";
  nObs?: number;
  columns?: { name: string; kind: string; nNonNull: number }[];
  written?: boolean;
}

/**
 * Normalize the commit response's discriminated union into one row shape, so the
 * panel maps over a single type and never reads `columns`/`format` on an error row.
 */
export function datasetRows(report: CommitAnnotationsResponse | null): DatasetRow[] {
  if (!report) return [];
  return report.datasets.map((d: CommitDatasetReport) =>
    "error" in d
      ? { datasetKey: d.datasetKey, path: d.path, error: d.error }
      : {
          datasetKey: d.datasetKey,
          path: d.path,
          error: null,
          format: d.format,
          nObs: d.nObs,
          columns: d.columns,
          written: d.written,
        },
  );
}

export interface CommitSummary {
  writableCount: number;
  failedCount: number;
  columnsWritten: number;
  /** True when the report has datasets but none are writable (all remote/error) — Confirm is disabled. */
  allBlocked: boolean;
}

export function commitSummary(report: CommitAnnotationsResponse | null): CommitSummary {
  const rows = datasetRows(report);
  const writable = rows.filter((r) => r.error === null);
  return {
    writableCount: writable.length,
    failedCount: rows.length - writable.length,
    columnsWritten: writable.reduce((n, r) => n + (r.columns?.length ?? 0), 0),
    allBlocked: rows.length > 0 && writable.length === 0,
  };
}

/** One-line status shown after a commit (also passed to `host.ui.notify`). */
export function commitStatusMessage(s: CommitSummary): string {
  const cols = `${s.columnsWritten} column${s.columnsWritten === 1 ? "" : "s"}`;
  const ds = `${s.writableCount} dataset${s.writableCount === 1 ? "" : "s"}`;
  const wrote = `wrote ${cols} across ${ds}`;
  return s.failedCount ? `${wrote}, ${s.failedCount} skipped` : wrote;
}
