/**
 * WorkspaceProvider: owns ONE Workspace per dataset session, created from the
 * server's workspace snapshot and disposed on unmount. `WorkspaceSync` keeps
 * it and the server in step; `WorkspaceHistory` follows the sync's revisions.
 */

import { useSelector } from "@tanstack/react-store";
import type { WorkspaceSnapshot } from "@ndea/protocol";
import { createContext, useContext, useEffect, useState } from "react";

import { useDatasetSession } from "@/hooks/useDatasetSession";
import { LAYOUT_EDITING_ENABLED } from "@/feature-flags";
import { deviceBroker } from "@/core/gpu/device-broker";
import { ComponentRuntimeContext } from "@/core/component/runtime/runtime-context";
import { ComponentRuntimeManager } from "@/core/component/runtime/workspace-runtime";
import { wsClient } from "@/lib/ws-client";
import { createHttpWorkspaceTransport, decodeWorkspaceDocument, WorkspaceSync, type WorkspaceTransport } from "./sync";
import { Workspace } from "./workspace-store";
import { WorkspaceHistory } from "./history";
import type { WorkspaceDocument, WorkspaceSession } from "./types";

const WorkspaceContext = createContext<Workspace | null>(null);
export interface WorkspacePersistenceState {
  readonly mode: "writable" | "recovery";
  readonly errors: readonly string[];
}
const WorkspacePersistenceContext = createContext<WorkspacePersistenceState>({ mode: "writable", errors: [] });
const WorkspaceHistoryContext = createContext<WorkspaceHistory | null>(null);

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
  const { coordinator, table } = runtime;
  const { metadata } = state;

  const [{ workspace: ws, componentRuntimes, initial, history }] = useState(() => {
    const w = new Workspace();
    // An invalid server document opens read-only and is never overwritten.
    const decoded = decodeWorkspaceDocument(snapshot.document);
    if (decoded.ok) w.applyDocument(decoded.state);
    if (LAYOUT_EDITING_ENABLED) (window as unknown as { __ndeaWorkspace?: Workspace }).__ndeaWorkspace = w;
    const appHost = Object.freeze({
      coordinator,
      table,
      metadata,
      refreshMetadata: actions.refreshMetadata,
      deviceBroker,
      fetch: globalThis.fetch,
    });
    return {
      workspace: w,
      initial: decoded,
      componentRuntimes: new ComponentRuntimeManager({ session: w, appHost }),
      history: new WorkspaceHistory(),
    };
  });
  const [persistence, setPersistence] = useState<WorkspacePersistenceState>(
    initial.ok ? { mode: "writable", errors: [] } : { mode: "recovery", errors: initial.errors },
  );

  useEffect(() => () => componentRuntimes.dispose(), [componentRuntimes]);

  // The server document is the authority; a read-only (recovery) session never writes.
  useEffect(() => {
    if (persistence.mode === "recovery" || !initial.ok) return;
    const sync = new WorkspaceSync(
      ws,
      { revision: snapshot.revision, document: initial.state },
      transport ?? createHttpWorkspaceTransport(wsClient),
      (errors) => setPersistence({ mode: "recovery", errors }),
    );
    const disconnect = history.connect(sync);
    sync.start();
    return () => {
      disconnect();
      sync.dispose();
    };
  }, [ws, initial, history, persistence.mode, snapshot, transport]);

  return (
    <WorkspacePersistenceContext.Provider value={persistence}>
      <WorkspaceHistoryContext.Provider value={history}>
        <WorkspaceContext.Provider value={ws}>
          <ComponentRuntimeContext.Provider value={componentRuntimes}>{children}</ComponentRuntimeContext.Provider>
        </WorkspaceContext.Provider>
      </WorkspaceHistoryContext.Provider>
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

export function useWorkspaceHistory(): WorkspaceHistory {
  const history = useContext(WorkspaceHistoryContext);
  if (!history) throw new Error("useWorkspaceHistory outside WorkspaceProvider");
  return history;
}

export function useWorkspaceSelector<T>(selector: (s: WorkspaceDocument) => T): T {
  return useSelector(useWorkspace().store, selector);
}

export function useWorkspaceSession<T>(selector: (s: WorkspaceSession) => T): T {
  return useSelector(useWorkspace().session, selector);
}
