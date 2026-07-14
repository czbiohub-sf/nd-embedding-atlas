// workspace: @ndea/sdk
// virtual-path: src/forbidden-app-import.ts
// expect-error: non-app workspaces cannot import @ndea/app

import type { Workspace } from "@ndea/app/workspace";

export type ForbiddenAppImport = Workspace;
