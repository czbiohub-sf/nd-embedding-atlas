/**
 * CommitPanel: the "Write to .obs on disk" surface, folded into the Annotate node
 * (rendered as an overlay over the body). Lists the dataset's staged annotation
 * columns, previews the write with a server dry-run, and commits only after an
 * explicit confirm. The write is full-column (NA for un-annotated obs) and
 * irreversible.
 *
 * "Which columns to commit" is server-side state grouped by dataset, not an edge
 * payload: so selection lives here. Union/all-remote logic is in `./commit-report`
 * so it stays unit-testable without a React DOM harness.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { commitStatusMessage, commitSummary, datasetRows } from "@/nodes/annotate/commit-report";
import type { CommitAnnotationsResponse } from "@/types";
import type { NodeHost } from "@ndea/sdk";
import type { AnnotateCapabilities } from "./plugin";

type Phase = "idle" | "checking" | "confirming" | "writing" | "done";

export function CommitPanel({
  host,
  onClose,
}: {
  host: Pick<NodeHost<unknown, AnnotateCapabilities>, "dataAPI" | "inputPredicate" | "notifications">;
  onClose: () => void;
}) {
  const [columns, setColumns] = useState<{ name: string; dtype: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [report, setReport] = useState<CommitAnnotationsResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);
  const inited = useRef(false);

  // Load staged columns; default-select all on first open.
  useEffect(() => {
    let alive = true;
    void host.dataAPI
      .listAnnotationColumns?.()
      ?.then((cols) => {
        if (!alive) return;
        setColumns(cols);
        if (!inited.current) {
          inited.current = true;
          setSelected(new Set(cols.map((c) => c.name)));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [host]);

  const scoped = (host.inputPredicate?.predicate?.(null) ?? null) != null;
  const selectedList = useMemo(
    () => columns.filter((c) => selected.has(c.name)).map((c) => c.name),
    [columns, selected],
  );
  const busy = phase === "checking" || phase === "writing";
  const rows = useMemo(() => datasetRows(report), [report]);
  const summary = useMemo(() => commitSummary(report), [report]);

  // A stale report must not be confirmed: changing the selection clears the
  // preview and re-hides Confirm, forcing a fresh dry-run (confirm-what-you-saw).
  const invalidate = useCallback(() => {
    setReport(null);
    setPhase((p) => (p === "confirming" || p === "done" ? "idle" : p));
  }, []);

  const toggle = useCallback(
    (name: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
      invalidate();
    },
    [invalidate],
  );

  const runDryRun = useCallback(async () => {
    if (!selectedList.length || busy) return;
    setPhase("checking");
    setStatus(null);
    try {
      const r = (await host.dataAPI.commitAnnotations?.({ dryRun: true, columns: selectedList })) ?? null;
      setReport(r);
      setPhase("confirming");
    } catch (err) {
      setStatus({ tone: "err", msg: err instanceof Error ? err.message : String(err) });
      setPhase("idle");
    }
  }, [selectedList, busy, host]);

  const confirmWrite = useCallback(async () => {
    if (busy || !report || summary.allBlocked) return;
    setPhase("writing");
    try {
      const r = (await host.dataAPI.commitAnnotations?.({ dryRun: false, columns: selectedList })) ?? null;
      const s = commitSummary(r);
      const msg = commitStatusMessage(s);
      setReport(r);
      setPhase("done");
      const tone = s.writableCount === 0 ? "err" : "ok";
      setStatus({ tone, msg });
      host.notifications.notify(msg, tone === "err" ? "error" : "info");
    } catch (err) {
      setStatus({ tone: "err", msg: err instanceof Error ? err.message : String(err) });
      setPhase("confirming");
    }
  }, [busy, report, summary.allBlocked, selectedList, host]);

  const noColumns = columns.length === 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card text-xs">
      <div className="flex items-center justify-between gap-2 border-border-subtle border-b p-2.5">
        <span className="font-medium text-foreground">Write to .obs on disk</span>
        <div className="flex items-center gap-2">
          {scoped && (
            <span className="rounded bg-surface-tertiary px-1.5 py-px text-3xs text-text-muted">scoped preview</span>
          )}
          <Button variant="ghost" size="sm" className="h-6 px-2 text-text-muted" onClick={onClose} title="close">
            ✕
          </Button>
        </div>
      </div>

      {/* staged-column selection */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {noColumns ? (
          <p className="text-2xs text-text-muted">No staged annotation columns yet. Label some obs first.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {columns.map((c) => (
              <label
                key={c.name}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-tertiary/40"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.name)}
                  onChange={() => toggle(c.name)}
                  className="size-3.5"
                />
                <span className="text-foreground">{c.name}</span>
                <span className="text-3xs text-text-muted">{c.dtype}</span>
              </label>
            ))}
          </div>
        )}

        {/* dry-run report */}
        {report && phase !== "idle" && phase !== "checking" && (
          <div className="mt-3 flex flex-col gap-2 border-border-subtle border-t pt-2.5">
            {rows.map((r) =>
              r.error !== null ? (
                <div
                  key={r.datasetKey}
                  className="rounded border border-warning/30 bg-warning/10 p-1.5 text-2xs text-warning"
                >
                  <span className="font-medium">{r.path ?? r.datasetKey}</span>: {r.error}
                </div>
              ) : (
                <div key={r.datasetKey} className="rounded border border-border-subtle p-1.5 text-2xs">
                  <div className="flex items-baseline justify-between">
                    <span className="truncate font-medium text-foreground" title={r.path}>
                      {r.path}
                    </span>
                    <span className="text-3xs text-text-muted">
                      {r.format} · {r.nObs?.toLocaleString()} obs
                    </span>
                  </div>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {(r.columns ?? []).map((col) => (
                      <div key={col.name} className="flex items-baseline justify-between text-text-muted">
                        <span>
                          {col.name} <span className="text-3xs">{col.kind}</span>
                        </span>
                        <span className="text-3xs">
                          {col.nNonNull.toLocaleString()} of {r.nObs?.toLocaleString()} labeled
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* actions */}
      <div className="flex flex-col gap-1.5 border-border-subtle border-t p-2.5">
        {phase === "idle" || phase === "checking" ? (
          <Button
            size="sm"
            className="h-8"
            disabled={noColumns || !selectedList.length || busy}
            onClick={() => void runDryRun()}
            title={noColumns ? "no staged columns" : !selectedList.length ? "select at least one column" : undefined}
          >
            {phase === "checking" ? "checking…" : "Write to .obs on disk"}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              className="h-8"
              disabled={busy || summary.allBlocked}
              onClick={() => void confirmWrite()}
              title={summary.allBlocked ? "no local datasets to write" : undefined}
            >
              {phase === "writing"
                ? "writing…"
                : summary.allBlocked
                  ? "nothing to write (all remote)"
                  : `Confirm: write ${summary.columnsWritten} column${summary.columnsWritten === 1 ? "" : "s"}`}
            </Button>
            {phase !== "done" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-3xs text-text-muted"
                disabled={busy}
                onClick={invalidate}
              >
                back
              </Button>
            )}
          </>
        )}
        {status && (
          <span
            className={cn("truncate text-3xs", status.tone === "ok" ? "text-success" : "text-destructive")}
            title={status.msg}
          >
            {status.tone === "ok" ? "✓" : "✗"} {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}
