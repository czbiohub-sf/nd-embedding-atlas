import { createContext, useContext } from "react";

import type { ComponentRuntimeManager } from "./workspace-runtime";

export const ComponentRuntimeContext = createContext<ComponentRuntimeManager | null>(null);

export function useComponentRuntimes(): ComponentRuntimeManager {
  const manager = useContext(ComponentRuntimeContext);
  if (!manager) throw new Error("useComponentRuntimes outside WorkspaceProvider");
  return manager;
}
