/**
 * Write-back descriptor — the plugin-backed body for the terminal write-back node.
 * Carries the `annotate` capability so `WriteBackView` can reach
 * `host.api.commitAnnotations` (and `listAnnotationColumns`) through the
 * capability-gated DataApi; `/api/*` stays in the host shim, never in the view.
 */

import { defineDescriptor, type NodeCapability } from "@/core/node/sdk";
import type { WriteBackConfig, WriteBackOptions } from "./view";

declare module "@/core/node/registry-types" {
  interface NodeTypeMap {
    "write-back": { config: WriteBackConfig; options: WriteBackOptions };
  }
}

const CAPABILITIES = new Set<NodeCapability>(["read", "annotate"]);

export const writeBackDescriptor = defineDescriptor<WriteBackConfig, WriteBackOptions>({
  id: "write-back",
  title: "Write-back",
  kind: "view",
  inputs: [{ id: "filter-in", kind: "pred", label: "In" }],
  outputs: [],
  capabilities: CAPABILITIES,
  placement: { container: "docked" },
  instancePolicy: "multi",
  icon: "hard-drive-download",
  load: async () => {
    const { WriteBackView } = await import("./view");
    return {
      Component: WriteBackView,
      defaultConfig: { columns: null },
    };
  },
});
