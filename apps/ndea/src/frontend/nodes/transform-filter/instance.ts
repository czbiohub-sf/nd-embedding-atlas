/**
 * Threshold-filter transform — imperative half (§6.8), split from the editor
 * Component so the view file stays component-only (Fast-Refresh boundary).
 *
 * Engine-agnostic: it knows only the plugin contract — `recompute(inputs, ctx)`
 * reads its params from `host.config` and emits the output predicate via
 * `host.publishPredicate`. The graph's transform-scoped host captures that publish.
 */

import type { NodeHost, NodeRuntime } from "@ndea/sdk";
import type { TransformCapabilities } from "@/core/graph/graph-host";
import type { ThresholdFilterConfig } from "./view";

/** AND two SQL predicates, dropping a null ("everything") operand. */
function andPredicate(a: string | null, b: string | null): string | null {
  if (a && b) return `(${a}) AND (${b})`;
  return a ?? b ?? null;
}

export function createThresholdFilterRuntime(
  host: NodeHost<ThresholdFilterConfig, TransformCapabilities>,
): NodeRuntime {
  return {
    recompute(inputs, _ctx) {
      const upstream = (inputs.get("filter-in")?.at(-1) ?? null) as string | null;
      const { column, threshold } = host.config;
      const clause = column ? `"${column.replaceAll('"', '""')}" > ${threshold}` : null;
      host.publishPredicate("transform", andPredicate(upstream, clause));
    },
    dispose() {},
  };
}
