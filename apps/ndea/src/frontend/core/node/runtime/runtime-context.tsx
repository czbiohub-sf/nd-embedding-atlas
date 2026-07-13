import type { ReactNode } from "react";

import type { WorkspaceNodeRuntimeManager } from "./workspace-runtime";
import { WorkspaceNodeRuntimeContext } from "./runtime-context-value";

export function WorkspaceNodeRuntimeProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: WorkspaceNodeRuntimeManager;
}) {
  return <WorkspaceNodeRuntimeContext.Provider value={value}>{children}</WorkspaceNodeRuntimeContext.Provider>;
}
