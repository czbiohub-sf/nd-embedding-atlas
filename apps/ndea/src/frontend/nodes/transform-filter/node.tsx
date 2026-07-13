/**
 * threshold — the DEPRECATED Threshold Filter transform (superseded by wrangle;
 * out of the palette, kept so older documents still load + cook). It is the ONE
 * instance-driven node: the GraphEngine cook drives the REAL plugin contract
 * (`createThresholdFilterInstance` + `makeTransformHost`), so it owns engine
 * registration via the `registerEngine` escape hatch (KTD3 — the single
 * documented residue of plugin-cook convergence) rather than a plain `cook`.
 *
 * The body renders the plugin's `ThresholdFilterView` against the per-node host
 * the workspace stashed during `registerEngine`.
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { andPreds, type Predicate } from "@/core/graph/engine";
import { asInstanceId } from "@ndea/sdk";
import { makeTransformHost } from "@/core/graph/graph-host";
import { transformFilterDescriptor } from "@/nodes/transform-filter/plugin";
import { createThresholdFilterInstance } from "@/nodes/transform-filter/instance";
import type { ThresholdFilterConfig, ThresholdFilterOptions } from "@/nodes/transform-filter/view";
import { ThresholdFilterView } from "@/nodes/transform-filter/view";
import { defineWsNode, predSqls } from "@/core/workspace/node-kit";
import { useWorkspace } from "@/core/workspace/workspace-context";
import type { WsNode } from "@/core/workspace/types";

// The one instance-driven node pairs an inline Body with its spec (intentional
// mixed export); fast-refresh can't split it.
// eslint-disable-next-line react/only-export-components
function ThresholdBody({ node }: { node: WsNode }) {
  const ws = useWorkspace();
  const host = ws.transformHosts.get(node.id);
  return host ? (
    <div className="nowheel nodrag min-h-0 flex-1 overflow-hidden">
      <ThresholdFilterView host={host} />
    </div>
  ) : null;
}

export const thresholdNode = defineWsNode<ThresholdFilterConfig>({
  id: "threshold",
  type: "threshold",
  title: "Threshold Filter",
  kind: "transform",
  pluginId: "transform-filter",
  inputs: [{ id: "in", kind: "pred", label: "In" }],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  engineKind: "transform",
  // never registered via the plain cook path (registerEngine owns it); this is
  // an inert placeholder so the spec satisfies the `cook` contract / `isWsNodeSpec`.
  cook: (inputs) => ({ kind: "pred", sql: andPreds(predSqls(inputs)) }),
  registerEngine(ctx) {
    // Driven by the real plugin instance through a transform-scoped host:
    // recompute publishes via host.publishPredicate → captured → cook result.
    let captured: Predicate = null;
    const host = makeTransformHost<ThresholdFilterConfig, ThresholdFilterOptions>({
      instanceId: asInstanceId(ctx.id),
      meta: transformFilterDescriptor,
      config: { column: null, threshold: 0 },
      coordinator: ctx.coordinator as Coordinator,
      table: ctx.table,
      metadata: ctx.metadata,
      onPublish: (sql) => {
        captured = sql;
      },
      onConfigPatch: () => ctx.markDirty(),
    });
    const instance = createThresholdFilterInstance(host);
    ctx.onDispose(() => instance.dispose());
    ctx.setTransformHost(host);
    ctx.addNode("transform", (inputs, pluginCtx) => {
      captured = null;
      // NodeInstance contract is unchanged: one composed predicate per port
      instance.recompute?.(new Map([["in", andPreds(predSqls(inputs))]]), pluginCtx);
      return { kind: "pred", sql: captured };
    });
  },
  Body: ThresholdBody,
  geometry: { chipW: 148, card: { w: 236, h: 124 }, full: { w: 258, h: 232 }, canFull: true },
  stage: "pin-only",
  inPalette: false,
});
