// workspace: @ndea/example-custom-node
// virtual-path: src/forbidden-deep-import.ts
// expect-error: @ndea/sdk/node is not an exported package entrypoint

import type { NodeDefinition } from "@ndea/sdk/node";

export type ForbiddenDeepImport = NodeDefinition;
