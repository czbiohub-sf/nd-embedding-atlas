// expect-error: Property 'register' does not exist on type 'NodeCatalog'

import type { NodeCatalog } from "@/core/plugin/catalog";

declare const catalog: NodeCatalog;
catalog.register;
