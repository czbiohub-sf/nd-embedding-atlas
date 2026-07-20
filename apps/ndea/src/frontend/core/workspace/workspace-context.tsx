/**
 * WorkspaceProvider: owns ONE Workspace (graph document + engine) per
 * dataset session. Created once; disposed on unmount.
 */

import { useSelector } from "@tanstack/react-store";
import { createContext, useContext, useEffect, useState } from "react";

import { useDatasetSession } from "@/hooks/useDatasetSession";
import { NODE_EDITOR_ENABLED } from "@/feature-flags";
import { predicateBus, rowSetBus } from "@/core/buses";
import type { GraphEvaluationState } from "@/core/graph/evaluator";
import { deviceBroker } from "@/core/gpu/device-broker";
import { WorkspaceNodeRuntimeProvider } from "@/core/node/runtime/runtime-context";
import { APP_NODE_HOST_CAPABILITIES, WorkspaceNodeRuntimeManager } from "@/core/node/runtime/workspace-runtime";
import type { Metadata } from "@/types";
import {
  browserWorkspaceStorage,
  loadFromStorage,
  storageKey,
  type LoadResult,
  type RecoveryStage,
  WorkspaceAutosave,
  type WorkspaceStorage,
} from "./persist";
import type { AppNodeLibrary } from "@/core/node/library";
import {
  browserNodeAssetJsonStorage,
  createNodeAssetLibrary,
  loadUserNodeAssetSource,
  type NodeAssetJsonStorage,
  type NodeAssetLibrary,
  type UserNodeAssetLoadResult,
} from "@/core/node-asset/library";
import { resolvePresetOrDefault } from "./presets";
import { Workspace } from "./workspace-store";
import type { WorkspaceDocumentState } from "./types";

const WorkspaceContext = createContext<Workspace | null>(null);
export interface WorkspacePersistenceState {
  readonly mode: "writable" | "recovery";
  readonly stage?: RecoveryStage;
  readonly errors: readonly string[];
  readonly backupKey?: string;
  readonly recoveryState?: WorkspaceDocumentState;
}
const WorkspacePersistenceContext = createContext<WorkspacePersistenceState>({
  mode: "writable",
  errors: [],
});

/** Debounce window for autosave: collapses a drag/edit burst into one write. */
const AUTOSAVE_MS = 500;

export function initializeWorkspaceDocument(
  workspace: Pick<Workspace, "loadDocument">,
  loaded: LoadResult,
  seed: () => void,
): WorkspacePersistenceState {
  if (loaded.kind === "ok") {
    workspace.loadDocument(loaded.state);
    return { mode: "writable", errors: [] };
  }
  if (loaded.kind === "miss") {
    seed();
    return { mode: "writable", errors: [] };
  }
  return {
    mode: "recovery",
    stage: loaded.stage,
    errors: loaded.errors,
    ...(loaded.backupKey ? { backupKey: loaded.backupKey } : {}),
    ...(loaded.state ? { recoveryState: loaded.state } : {}),
  };
}

export function applyNodeAssetRecovery(
  persistence: WorkspacePersistenceState,
  loaded: UserNodeAssetLoadResult,
): WorkspacePersistenceState {
  if (loaded.kind !== "recovery") return persistence;
  const error = `user node asset storage: ${loaded.error}`;
  return persistence.mode === "recovery"
    ? { ...persistence, errors: [...persistence.errors, error] }
    : { mode: "recovery", stage: "config", errors: [error] };
}

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
  storage,
  nodeAssets,
  nodeAssetStorage,
}: {
  children: React.ReactNode;
  nodeLibrary: AppNodeLibrary;
  storage?: WorkspaceStorage;
  nodeAssets?: NodeAssetLibrary;
  nodeAssetStorage?: NodeAssetJsonStorage;
}) {
  const { state, runtime, actions } = useDatasetSession();
  const { coordinator, brushSelection, table } = runtime;
  const { metadata } = state;

  const [{ workspace: ws, nodeRuntimes, persistence: initialPersistence, workspaceStorage, workspaceKey }] = useState(
    () => {
      const resolvedAssetStorage = nodeAssetStorage ?? browserNodeAssetJsonStorage();
      const loadedUserAssets = loadUserNodeAssetSource(resolvedAssetStorage);
      const availableAssets = createNodeAssetLibrary([
        ...(nodeAssets?.sources().filter((source) => source.kind !== "user") ?? []),
        loadedUserAssets.source,
      ]);
      const w = new Workspace({
        coordinator,
        table,
        metadata,
        nodeLibrary,
        nodeAssets: availableAssets,
        ...(loadedUserAssets.kind === "recovery" ? {} : { nodeAssetStorage: resolvedAssetStorage }),
      });
      const resolvedStorage = storage ?? browserWorkspaceStorage();
      const resolvedKey = storageKey(sessionKeyOf(metadata, table));
      let persistence: WorkspacePersistenceState = { mode: "writable", errors: [] };
      if (NODE_EDITOR_ENABLED) {
        // Seed only after a confirmed miss. Any read, migration, backup, or
        // rewrite failure keeps a validated document read-only when possible.
        const loaded = loadFromStorage(resolvedStorage, resolvedKey, w.nodeLibrary);
        persistence = initializeWorkspaceDocument(w, loaded, () => {
          resolvePresetOrDefault(metadata.preset)(w);
          w.setDisposition("full");
        });
        persistence = applyNodeAssetRecovery(persistence, loadedUserAssets);
        (window as unknown as { __ndeaWorkspace?: Workspace }).__ndeaWorkspace = w;
      } else {
        // Editor-disabled mode: the named preset seeds a fresh, dataset-agnostic
        // graph and layout on every launch. An unknown --preset falls back to annotate.
        resolvePresetOrDefault(metadata.preset)(w);
        persistence = applyNodeAssetRecovery(persistence, loadedUserAssets);
      }
      const appHost = Object.freeze({
        coordinator,
        defaultInputPredicate: brushSelection,
        table,
        metadata,
        refreshMetadata: actions.refreshMetadata,
        availableCapabilities: new Set(APP_NODE_HOST_CAPABILITIES),
        predicateBus,
        rowSetBus,
        deviceBroker,
        fetch: globalThis.fetch,
      });
      return {
        workspace: w,
        persistence,
        workspaceStorage: resolvedStorage,
        workspaceKey: resolvedKey,
        nodeRuntimes: new WorkspaceNodeRuntimeManager({
          session: w,
          nodeLibrary: w.nodeLibrary,
          appHost,
        }),
      };
    },
  );
  const [persistence, setPersistence] = useState(initialPersistence);

  useEffect(
    () => () => {
      const errors: unknown[] = [];
      try {
        nodeRuntimes.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        ws.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Workspace teardown failed");
    },
    [nodeRuntimes, ws],
  );

  // Autosave: persist the document on any store change, debounced. The store is
  // the topology/presentation authority: engine-only runtime (lassoes, cache
  // pins) is intentionally not persisted; the doc round-trips and re-cooks.
  useEffect(() => {
    // Editor-disabled sessions persist nothing; the preset is authoritative.
    if (!NODE_EDITOR_ENABLED) return;
    if (persistence.mode === "recovery") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const autosave = new WorkspaceAutosave(workspaceStorage, workspaceKey, (error) => {
      setPersistence({
        mode: "recovery",
        stage: "autosave",
        errors: [error instanceof Error ? error.message : String(error)],
      });
    });
    const sub = ws.store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => autosave.save(ws.store.state), AUTOSAVE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [ws, persistence.mode, workspaceStorage, workspaceKey]);

  return (
    <WorkspacePersistenceContext.Provider value={persistence}>
      <WorkspaceContext.Provider value={ws}>
        <WorkspaceNodeRuntimeProvider value={nodeRuntimes}>{children}</WorkspaceNodeRuntimeProvider>
      </WorkspaceContext.Provider>
    </WorkspacePersistenceContext.Provider>
  );
}

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error("useWorkspace outside WorkspaceProvider");
  return ws;
}

export function useWorkspacePersistence(): WorkspacePersistenceState {
  return useContext(WorkspacePersistenceContext);
}

export function useWorkspaceSelector<T>(selector: (s: WorkspaceDocumentState) => T): T {
  const ws = useWorkspace();
  return useSelector(ws.store, selector);
}

export function useTelemetrySelector<T>(selector: (t: GraphEvaluationState) => T): T {
  const ws = useWorkspace();
  return useSelector(ws.telemetry, selector);
}
