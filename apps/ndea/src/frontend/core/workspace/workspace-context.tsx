/**
 * WorkspaceProvider: owns ONE Workspace per dataset session, created from the
 * server's workspace snapshot and disposed on unmount. `WorkspaceSync` keeps
 * it and the server in step.
 */

import { useSelector } from "@tanstack/react-store";
import type { WorkspaceSnapshot } from "@ndea/protocol";
import { createContext, useContext, useEffect, useState } from "react";

import { useDatasetSession } from "@/hooks/useDatasetSession";
import { NODE_EDITOR_ENABLED } from "@/feature-flags";
import { deviceBroker } from "@/core/gpu/device-broker";
import { WorkspaceNodeRuntimeProvider } from "@/core/node/runtime/runtime-context";
import { WorkspaceNodeRuntimeManager } from "@/core/node/runtime/workspace-runtime";
import { availableNodeCapabilities } from "@/core/node/capabilities";
import { wsClient } from "@/lib/ws-client";
import { createHttpWorkspaceTransport, decodeWorkspaceDocument, WorkspaceSync, type WorkspaceTransport } from "./sync";
import { Workspace } from "./workspace-store";
import type { WorkspaceDocument, WorkspaceSession } from "./types";

const WorkspaceContext = createContext<Workspace | null>(null);
export interface WorkspacePersistenceState {
  readonly mode: "writable" | "recovery";
  readonly errors: readonly string[];
}
const WorkspacePersistenceContext = createContext<WorkspacePersistenceState>({ mode: "writable", errors: [] });

export function WorkspaceProvider({
  children,
  snapshot,
  transport,
}: {
  children: React.ReactNode;
  /** Server document this session opens. */
  snapshot: WorkspaceSnapshot;
  transport?: WorkspaceTransport;
}) {
  const { state, runtime, actions } = useDatasetSession();
  const { coordinator, brushSelection, table } = runtime;
  const { metadata } = state;

  const [{ workspace: ws, nodeRuntimes, initial }] = useState(() => {
    const w = new Workspace();
    // An invalid server document opens read-only and is never overwritten.
    const decoded = decodeWorkspaceDocument(snapshot.document);
    if (decoded.ok) w.applyDocument(decoded.state);
    if (NODE_EDITOR_ENABLED) (window as unknown as { __ndeaWorkspace?: Workspace }).__ndeaWorkspace = w;
    const appHost = Object.freeze({
      coordinator,
      defaultInputPredicate: brushSelection,
      table,
      metadata,
      refreshMetadata: actions.refreshMetadata,
      availableCapabilities: new Set(availableNodeCapabilities),
      deviceBroker,
      fetch: globalThis.fetch,
    });
    return {
      workspace: w,
      initial: decoded,
      nodeRuntimes: new WorkspaceNodeRuntimeManager({ session: w, appHost }),
    };
  });
  const [persistence, setPersistence] = useState<WorkspacePersistenceState>(
    initial.ok ? { mode: "writable", errors: [] } : { mode: "recovery", errors: initial.errors },
  );

  useEffect(() => () => nodeRuntimes.dispose(), [nodeRuntimes]);

  // The server document is the authority; a read-only (recovery) session never writes.
  useEffect(() => {
    if (persistence.mode === "recovery" || !initial.ok) return;
    const sync = new WorkspaceSync(
      ws,
      { revision: snapshot.revision, document: initial.state },
      transport ?? createHttpWorkspaceTransport(wsClient),
      (errors) => setPersistence({ mode: "recovery", errors }),
    );
    sync.start();
    return () => sync.dispose();
  }, [ws, initial, persistence.mode, snapshot, transport]);

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

export function useWorkspaceSelector<T>(selector: (s: WorkspaceDocument) => T): T {
  return useSelector(useWorkspace().store, selector);
}

export function useWorkspaceSession<T>(selector: (s: WorkspaceSession) => T): T {
  return useSelector(useWorkspace().session, selector);
}
