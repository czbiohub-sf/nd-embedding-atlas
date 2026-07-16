// workspace: @ndea/app
// virtual-path: src/frontend/core/node/forbidden-workspace-import.ts
// expect-error: graph, node, and plugin cores cannot import Workspace composition

import type { Workspace } from "@/core/workspace/workspace";

export type ForbiddenWorkspaceImport = Workspace;
