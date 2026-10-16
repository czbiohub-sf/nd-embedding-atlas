import type { ReactNode } from "react";

import type { ComponentRuntimeManager } from "./workspace-runtime";
import { ComponentRuntimeContext } from "./runtime-context-value";

export function ComponentRuntimeProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: ComponentRuntimeManager;
}) {
  return <ComponentRuntimeContext.Provider value={value}>{children}</ComponentRuntimeContext.Provider>;
}
