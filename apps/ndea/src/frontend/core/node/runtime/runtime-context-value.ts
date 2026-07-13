import { createContext, useContext } from "react";

import type { WorkspaceNodeRuntimeManager } from "./workspace-runtime";

export const WorkspaceNodeRuntimeContext = createContext<WorkspaceNodeRuntimeManager | null>(null);

export function useWorkspaceNodeRuntimes(): WorkspaceNodeRuntimeManager {
  const manager = useContext(WorkspaceNodeRuntimeContext);
  if (!manager) throw new Error("useWorkspaceNodeRuntimes outside WorkspaceNodeRuntimeProvider");
  return manager;
}
