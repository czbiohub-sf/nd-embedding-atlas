/**
 * WorkspaceProvider — owns ONE Workspace (graph document + engine) per
 * dataset session. Created once; disposed on unmount.
 */

import { useSelector } from "@tanstack/react-store";
import { createContext, useContext, useEffect, useState } from "react";

import { useDashboard } from "@/hooks/useDashboard";
import type { GraphEvaluationState } from "@/core/graph/evaluator";
import type { Metadata } from "@/types";
import { loadFromStorage, saveToStorage, storageKey } from "./persist";
import type { WorkspaceNodeLibrary } from "./node-kit";
import { resolvePreset, seedAnnotate } from "./presets";
import { seedWorkspace, Workspace } from "./workspace-store";
import type { WorkspaceDocumentState } from "./types";

const WorkspaceContext = createContext<Workspace | null>(null);

/** Debounce window for autosave — collapses a drag/edit burst into one write. */
const AUTOSAVE_MS = 500;

/**
 * A stable per-dataset session key for the persisted document. Derived from the
 * dataset identity (`metadata.props.data.id`) + the DuckDB table, so the same
 * dataset reloads the same workspace and switching datasets gets a fresh doc. If
 * neither is present we return `null` and the storage layer falls back to a
 * single shared `"ndea.workspace"` key.
 */
function sessionKeyOf(metadata: Metadata, table: string): string | null {
  const id = metadata.props?.data?.id;
  const parts = [id, table].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length > 0 ? parts.join(":") : null;
}

export function WorkspaceProvider({
  children,
  nodeLibrary,
}: {
  children: React.ReactNode;
  nodeLibrary: WorkspaceNodeLibrary;
}) {
  const { state, meta } = useDashboard();
  const { coordinator, table } = meta;
  const { metadata } = state;

  const [ws] = useState(() => {
    const w = new Workspace({ coordinator, table, metadata, nodeLibrary });
    if (import.meta.env.DEV) {
      // Dev server: editable session. Load-or-seed seam (U7→persistence) — read
      // the saved PersistedDoc for this dataset session, validate it
      // (parse-on-load), and hydrate it (engine registration + edges included so
      // it actually cooks); fall back to seedWorkspace on a miss or corrupt doc.
      const key = storageKey(sessionKeyOf(metadata, table));
      const loaded = loadFromStorage(key, nodeLibrary);
      if (loaded.kind === "ok") {
        w.loadDocument(loaded.state);
      } else {
        if (loaded.kind === "invalid") {
          console.warn("[workspace] saved document rejected, seeding fresh:", loaded.errors.join("; "));
        }
        seedWorkspace(w);
      }
      (window as unknown as { __ndeaWorkspace?: Workspace }).__ndeaWorkspace = w;
    } else {
      // Shipped build: the named preset (default annotate) seeds a fresh graph +
      // layout against the mounted dataset — dataset-agnostic, authoritative on
      // every launch (R7, read-only). A typo'd/unknown --preset falls back to the
      // annotate default.
      const seed = resolvePreset(metadata.preset ?? "annotate") ?? seedAnnotate;
      seed(w);
    }
    return w;
  });

  useEffect(() => () => ws.dispose(), [ws]);

  // Autosave: persist the document on any store change, debounced. The store is
  // the topology/presentation authority — engine-only runtime (lassoes, cache
  // pins) is intentionally not persisted; the doc round-trips and re-cooks.
  useEffect(() => {
    // Builds persist nothing — the bundled preset is authoritative every launch (R7).
    if (!import.meta.env.DEV) return;
    const key = storageKey(sessionKeyOf(metadata, table));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = ws.store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => saveToStorage(key, ws.store.state), AUTOSAVE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [ws, metadata, table]);

  return <WorkspaceContext.Provider value={ws}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error("useWorkspace outside WorkspaceProvider");
  return ws;
}

export function useWorkspaceSelector<T>(selector: (s: WorkspaceDocumentState) => T): T {
  const ws = useWorkspace();
  return useSelector(ws.store, selector);
}

export function useTelemetrySelector<T>(selector: (t: GraphEvaluationState) => T): T {
  const ws = useWorkspace();
  return useSelector(ws.telemetry, selector);
}
