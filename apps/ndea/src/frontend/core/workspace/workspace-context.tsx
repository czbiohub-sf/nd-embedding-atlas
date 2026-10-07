/**
 * WorkspaceProvider: owns ONE Workspace (graph document + engine) per
 * dataset session. Created once from the server's workspace snapshot;
 * disposed on unmount. `WorkspaceSync` keeps it and the server in step.
 */

import { useSelector } from "@tanstack/react-store";
import type { WorkspaceSnapshot } from "@ndea/protocol";
import { createContext, useContext, useEffect, useState } from "react";

import { useDatasetSession } from "@/hooks/useDatasetSession";
import { NODE_EDITOR_ENABLED } from "@/feature-flags";
import type { GraphEvaluationState } from "@ndea/graph";
import { deviceBroker } from "@/core/gpu/device-broker";
import { WorkspaceNodeRuntimeProvider } from "@/core/node/runtime/runtime-context";
import { APP_NODE_HOST_CAPABILITIES, WorkspaceNodeRuntimeManager } from "@/core/node/runtime/workspace-runtime";
import type { AppNodeLibrary } from "@/core/node/library";
import {
  browserNodeAssetJsonStorage,
  createNodeAssetLibrary,
  loadUserNodeAssetSource,
  type NodeAssetJsonStorage,
  type NodeAssetLibrary,
  type UserNodeAssetLoadResult,
} from "@/core/node-asset/library";
import { wsClient } from "@/lib/ws-client";
import { parseWorkspaceDocument } from "./document";
import { resolvePresetOrDefault } from "./presets";
import { createHttpWorkspaceTransport, decodeWorkspaceDocument, WorkspaceSync, type WorkspaceTransport } from "./sync";
import { Workspace } from "./workspace-store";
import type { WorkspaceDocumentState } from "./types";

const WorkspaceContext = createContext<Workspace | null>(null);
export interface WorkspacePersistenceState {
  readonly mode: "writable" | "recovery";
  readonly errors: readonly string[];
}
const WorkspacePersistenceContext = createContext<WorkspacePersistenceState>({
  mode: "writable",
  errors: [],
});

/**
 * Load the server document, or seed a preset when the server has none. An
 * invalid document opens read-only and is never overwritten by a seed.
 */
export function initializeWorkspaceDocument(
  workspace: Pick<Workspace, "loadDocument"> & { readonly nodeLibrary: AppNodeLibrary },
  document: unknown,
  seed: () => void,
): WorkspacePersistenceState {
  if (document === null) {
    seed();
    return { mode: "writable", errors: [] };
  }
  const decoded = decodeWorkspaceDocument(document, workspace.nodeLibrary);
  if (!decoded.ok) return { mode: "recovery", errors: decoded.errors };
  workspace.loadDocument(decoded.state);
  return { mode: "writable", errors: [] };
}

export function applyNodeAssetRecovery(
  persistence: WorkspacePersistenceState,
  loaded: UserNodeAssetLoadResult,
): WorkspacePersistenceState {
  if (loaded.kind !== "recovery") return persistence;
  return { mode: "recovery", errors: [...persistence.errors, `user node asset storage: ${loaded.error}`] };
}

export function WorkspaceProvider({
  children,
  nodeLibrary,
  snapshot,
  transport,
  nodeAssets,
  nodeAssetStorage,
}: {
  children: React.ReactNode;
  nodeLibrary: AppNodeLibrary;
  /** Server document this session opens; `document: null` seeds the preset. */
  snapshot: WorkspaceSnapshot;
  transport?: WorkspaceTransport;
  nodeAssets?: NodeAssetLibrary;
  nodeAssetStorage?: NodeAssetJsonStorage;
}) {
  const { state, runtime, actions } = useDatasetSession();
  const { coordinator, brushSelection, table } = runtime;
  const { metadata } = state;

  const [{ workspace: ws, nodeRuntimes, persistence: initialPersistence }] = useState(() => {
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
    const persistence = applyNodeAssetRecovery(
      initializeWorkspaceDocument(w, snapshot.document, () => resolvePresetOrDefault(metadata.preset)(w)),
      loadedUserAssets,
    );
    // Session state: the editor opens on the canvas; a fixed-preset build has no canvas, so the Stage fills.
    w.setDisposition(NODE_EDITOR_ENABLED ? "full" : "hidden");
    if (NODE_EDITOR_ENABLED) (window as unknown as { __ndeaWorkspace?: Workspace }).__ndeaWorkspace = w;
    const appHost = Object.freeze({
      coordinator,
      defaultInputPredicate: brushSelection,
      table,
      metadata,
      refreshMetadata: actions.refreshMetadata,
      availableCapabilities: new Set(APP_NODE_HOST_CAPABILITIES),
      deviceBroker,
      fetch: globalThis.fetch,
    });
    return {
      workspace: w,
      persistence,
      nodeRuntimes: new WorkspaceNodeRuntimeManager({ session: w, nodeLibrary: w.nodeLibrary, appHost }),
    };
  });
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

  // The server document is the authority; a read-only (recovery) session never writes.
  useEffect(() => {
    if (persistence.mode === "recovery") return;
    // Already decoded at init; parsing again yields the typed, unmigrated server copy as the diff base.
    const acked = snapshot.document === null ? null : parseWorkspaceDocument(snapshot.document);
    if (acked && !acked.ok) return;
    const sync = new WorkspaceSync(
      ws,
      { revision: snapshot.revision, document: acked?.value ?? null },
      transport ?? createHttpWorkspaceTransport(wsClient),
      (errors) => setPersistence({ mode: "recovery", errors }),
    );
    sync.start();
    return () => sync.dispose();
  }, [ws, persistence.mode, snapshot, transport]);

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
