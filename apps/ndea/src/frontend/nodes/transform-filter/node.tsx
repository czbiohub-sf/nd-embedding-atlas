/**
 * threshold — the DEPRECATED Threshold Filter transform (superseded by wrangle;
 * out of the palette, kept so older documents still load + cook). It is the ONE
 * instance-driven node: the GraphEngine cook drives the REAL plugin contract
 * (`createThresholdFilterInstance` + `makeTransformHost`), so it owns engine
 * registration via the `registerEvaluation` escape hatch (KTD3 — the single
 * documented residue of plugin-cook convergence) rather than a plain `cook`.
 *
 * The body renders the plugin's `ThresholdFilterView` against the per-node host
 * the workspace stashed during `registerEvaluation`.
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { andPreds, type Predicate } from "@/core/graph/engine";
import { nodeInstanceId } from "@ndea/sdk";
import { makeTransformHost } from "@/core/graph/graph-host";
import { transformFilterDefinition } from "@/nodes/transform-filter/plugin";
import { createThresholdFilterRuntime } from "@/nodes/transform-filter/instance";
import type { ThresholdFilterConfig } from "@/nodes/transform-filter/view";
import { ThresholdFilterView } from "@/nodes/transform-filter/view";
import { defineNativeNodeContribution } from "@/core/workspace/node-kit";
import { assertSynchronousNodeRuntime, predicateSqls } from "@/core/graph/cook";
import { useWorkspace } from "@/core/workspace/workspace-context";
import type { GraphDocumentNode } from "@/core/graph/records";

// The one instance-driven node pairs an inline Body with its spec (intentional
// mixed export); fast-refresh can't split it.
// eslint-disable-next-line react/only-export-components
function ThresholdBody({ node }: { node: GraphDocumentNode }) {
  const ws = useWorkspace();
  const host = ws.transformHosts.get(node.id);
  return host ? (
    <div className="nowheel nodrag min-h-0 flex-1 overflow-hidden">
      <ThresholdFilterView host={host} />
    </div>
  ) : null;
}

export const thresholdNode = defineNativeNodeContribution({
  definition: transformFilterDefinition,
  graph: {
    persistedType: "threshold",
    role: "transform",
    evaluationRole: "transform",
    cook: (inputs) => ({ kind: "pred", sql: andPreds(predicateSqls(inputs)) }),
    registerEvaluation(ctx) {
      let captured: Predicate = null;
      const configContract = transformFilterDefinition.config;
      if (!configContract) throw new Error("transform-filter definition requires a config contract");
      const hostHandle = makeTransformHost<ThresholdFilterConfig>({
        instanceId: nodeInstanceId(ctx.id),
        definitionRef: transformFilterDefinition.ref,
        config: { ...configContract.defaultValue },
        coordinator: ctx.coordinator as Coordinator,
        table: ctx.table,
        metadata: ctx.metadata,
        onPublish: (sql) => {
          captured = sql;
        },
        onConfigPatch: () => ctx.markDirty(),
      });
      const { host } = hostHandle;
      const runtime = createThresholdFilterRuntime(host);
      ctx.onDispose(() => {
        runtime.dispose();
        hostHandle.dispose();
      });
      ctx.setTransformHost(host);
      ctx.addNode("transform", (inputs, pluginCtx) => {
        captured = null;
        if (!runtime.recompute) throw new Error("transform-filter runtime must define synchronous recompute");
        const result = runtime.recompute(new Map([["filter-in", [andPreds(predicateSqls(inputs))]]]), pluginCtx);
        assertSynchronousNodeRuntime(result);
        return { kind: "pred", sql: captured };
      });
    },
    Body: ThresholdBody,
    usesDefinitionModule: true,
  },
  workspace: {
    geometry: { chipW: 148, card: { w: 236, h: 124 }, full: { w: 258, h: 232 }, canFull: true },
    stage: "pin-only",
    inPalette: false,
  },
});
