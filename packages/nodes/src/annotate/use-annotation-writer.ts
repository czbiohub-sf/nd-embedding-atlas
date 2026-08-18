/**
 * useAnnotationWriter: the shared labeling core behind every annotating node.
 *
 * Owns the four pieces any labeling surface needs and nothing else: the
 * server-registered annotation column list, the in-flight/status pair, the
 * optimistic per-obs overlay, and the two write doors (`stampRows` for an
 * explicit row set, `writeByPredicate` for a whole scope).
 *
 * Deliberately UI-free: it knows nothing about tables, carousels, vocabularies,
 * hotkeys, or node config. That is what lets the Annotate table and the Compare
 * carousel share one write path — and one overlay contract — without either
 * importing the other's component tree.
 *
 * The overlay is keyed obs → column → value because a single user action can
 * stamp more than one column (range mode writes `{base}_min` and `{base}_max`
 * together), and the consuming grid looks up cells by column name.
 */

import type { AnnotationDtype } from "@ndea/protocol";
import type { NodeHost, RowIndex } from "@ndea/sdk";
import { useCallback, useEffect, useRef, useState } from "react";

/** Minimum capability set that materializes the annotation methods on `dataAPI`. */
type WriterCapabilities = "data-read" | "annotation-write";

/**
 * Structural host slice, mirroring {@link CommitPanel}'s: any node host that
 * declares `data-read` + `annotation-write` satisfies it, so the hook never
 * couples to one node's capability tuple.
 */
export type AnnotationWriterHost = Pick<NodeHost<unknown, WriterCapabilities>, "dataAPI">;

/** Per-obs, per-column optimistic overlay: obs row → column name → value. */
export type AnnotationOverlay = Map<RowIndex, Map<string, string>>;

/** One column/value pair in a multi-column write. */
export interface AnnotationWrite {
  column: string;
  value: string;
}

export interface AnnotationWriter {
  /** Annotation columns registered server-side; refreshed after each create. */
  columns: string[];
  /** True while a write is in flight. Callers should disable their controls. */
  busy: boolean;
  /** Last status line (`✓ …` or `✗ …`), or null. */
  status: string | null;
  setStatus: (status: string | null) => void;
  /** Optimistic overlay so a stamp paints before the next query round-trips. */
  localLabels: AnnotationOverlay;
  /** Number of obs carrying an optimistic stamp this session. */
  stampedCount: number;
  /**
   * Create `name` if it is not already registered. Idempotent, so callers may
   * invoke it unconditionally before a write.
   */
  ensureColumn: (name: string, dtype?: AnnotationDtype) => Promise<void>;
  /**
   * Write `value` into `column` for every obs matching `predicate`.
   * Returns the server's matched-row count, or null when the write failed.
   */
  writeByPredicate: (column: string, value: string, predicate: string) => Promise<number | null>;
  /**
   * Write several columns over one predicate under a SINGLE busy guard, so a
   * multi-column stamp (a `{base}_min`/`{base}_max` pair) cannot interleave
   * with another write or flicker the disabled state between the two halves.
   * Returns the last write's matched-row count, or null when any write failed.
   */
  writeManyByPredicate: (entries: readonly AnnotationWrite[], predicate: string) => Promise<number | null>;
  /**
   * Write `value` into `column` for exactly `ids`, updating the overlay on
   * success. Returns the matched-row count, or null when the write failed or
   * there was nothing to write.
   */
  stampRows: (column: string, value: string, ids: readonly RowIndex[]) => Promise<number | null>;
  /** Merge overlay entries directly, for writes that touch several columns. */
  applyOverlay: (ids: readonly RowIndex[], values: Readonly<Record<string, string>>) => void;
}

export function useAnnotationWriter(host: AnnotationWriterHost): AnnotationWriter {
  const [columns, setColumns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [localLabels, setLocalLabels] = useState<AnnotationOverlay>(() => new Map());

  // Creation is deduped through a ref, not `columns` state: a caller routinely
  // ensures a column and writes to it in the same tick, and the state update
  // has not landed by then. Keying in-flight promises makes ensureColumn both
  // idempotent and concurrency-safe, and keeps its identity stable so every
  // write callback below does not re-create on each column list change.
  const ensuredRef = useRef<Map<string, Promise<void>>>(new Map());

  // Load the registered column list once per host.
  useEffect(() => {
    let alive = true;
    // A new host is a new dataset: neither the previous one's ensured set nor
    // its column list describes what exists server-side. Clear both
    // synchronously. Leaving `columns` populated would let a consumer's
    // `columns.includes(name)` guard short-circuit against the old dataset's
    // schema until the new list resolves.
    ensuredRef.current = new Map();
    setColumns([]);
    void host.dataAPI
      .listAnnotationColumns?.()
      ?.then((cols) => {
        if (!alive) return;
        setColumns(cols.map((c) => c.name));
        // Seed the dedupe cache so an already-registered column resolves
        // without a redundant create round-trip. Merge rather than replace: a
        // create issued while this list was in flight must keep its promise.
        for (const c of cols) {
          if (!ensuredRef.current.has(c.name)) ensuredRef.current.set(c.name, Promise.resolve());
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [host]);

  const applyOverlay = useCallback((ids: readonly RowIndex[], values: Readonly<Record<string, string>>) => {
    const entries = Object.entries(values);
    if (entries.length === 0 || ids.length === 0) return;
    setLocalLabels((prev) => {
      const next = new Map(prev);
      for (const id of ids) {
        // Merge rather than replace: a row may already carry a stamp from a
        // different column, and dropping it would blank a painted cell.
        const merged = new Map(next.get(id));
        for (const [col, value] of entries) merged.set(col, value);
        next.set(id, merged);
      }
      return next;
    });
  }, []);

  const ensureColumn = useCallback(
    (name: string, dtype?: AnnotationDtype): Promise<void> => {
      const inFlight = ensuredRef.current.get(name);
      if (inFlight) return inFlight;
      const pending = (async () => {
        await host.dataAPI.createAnnotationColumn?.(name, dtype);
        setColumns((prev) => (prev.includes(name) ? prev : [...prev, name]));
      })();
      ensuredRef.current.set(name, pending);
      // A failed create must not poison the cache: drop it so a retry can run.
      void pending.catch(() => ensuredRef.current.delete(name));
      return pending;
    },
    [host],
  );

  const writeManyByPredicate = useCallback(
    async (entries: readonly AnnotationWrite[], predicate: string): Promise<number | null> => {
      if (entries.length === 0 || busy) return null;
      setBusy(true);
      setStatus(null);
      try {
        let n = 0;
        // Sequential, not Promise.all: these share one DuckDB connection and a
        // partial failure should stop rather than race the remaining columns.
        for (const { column, value } of entries) {
          const res = await host.dataAPI.writeAnnotationByPredicate?.(column, value, predicate);
          n = res?.n ?? 0;
        }
        return n;
      } catch (err) {
        setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy, host],
  );

  const writeByPredicate = useCallback(
    (column: string, value: string, predicate: string): Promise<number | null> =>
      writeManyByPredicate([{ column, value }], predicate),
    [writeManyByPredicate],
  );

  const stampRows = useCallback(
    async (column: string, value: string, ids: readonly RowIndex[]): Promise<number | null> => {
      if (!column || !value || ids.length === 0 || busy) return null;
      setBusy(true);
      setStatus(null);
      try {
        await ensureColumn(column);
        const res = await host.dataAPI.writeAnnotationByPredicate?.(
          column,
          value,
          `__row_index__ IN (${ids.join(", ")})`,
        );
        applyOverlay(ids, { [column]: value });
        return res?.n ?? ids.length;
      } catch (err) {
        setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [applyOverlay, busy, ensureColumn, host],
  );

  return {
    columns,
    busy,
    status,
    setStatus,
    localLabels,
    stampedCount: localLabels.size,
    ensureColumn,
    writeByPredicate,
    writeManyByPredicate,
    stampRows,
    applyOverlay,
  };
}
