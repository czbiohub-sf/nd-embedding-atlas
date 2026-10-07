import { useEffect } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";

import type { GraphDocumentNode } from "@/core/graph/records";
import { useNodeFeedbackContext } from "../feedback";
import { useNodeCount } from "../use-node-count";
import { useTelemetrySelector, useWorkspace, useWorkspaceSelector, useWorkspaceSession } from "../workspace-context";
import type { Workspace } from "../workspace-store";
import { resolveNodeForm, resolveNodeSize } from "./port-positions";
import {
  formatNodeCount,
  isNodeCountActive,
  resolveNodeBodyMode,
  resolveNodeLedState,
  shouldShowNodeCount,
} from "./nd-graph-node-model";

function useNdGraphNodeLayoutState(id: string) {
  const node = useWorkspaceSelector((state) => state.nodes[id]);
  const locked = useWorkspaceSelector((state) => state.formLocked[id] ?? false);

  // These focused subscriptions invalidate form/size without widening any selector.
  useWorkspaceSelector((state) => state.formOverride[id]);
  useWorkspaceSelector((state) => state.sizeOverrides[id]);
  useWorkspaceSelector((state) => state.stage);
  useWorkspaceSession((state) => state.disposition);
  useWorkspaceSession((session) => session.baseForm);

  const flipHidden = useWorkspaceSession((session) => session.flipHide === `canvas:${id}`);
  const resizing = useWorkspaceSession((session) => session.resizing === id);
  const fullscreen = useWorkspaceSession((session) => session.fullscreen === id);

  return { node, locked, flipHidden, resizing, fullscreen };
}

function useNdGraphNodeGraphState(id: string) {
  const inMarquee = useWorkspaceSession((state) => state.selectedNodeIds.includes(id));
  const flagsState = useWorkspaceSelector((state) => state.flags[id]);
  const claimed = useWorkspaceSession((state) => state.claimed === id);
  const fanIn = useWorkspaceSelector(
    (state) => Object.values(state.edges).filter((edge) => edge.to === id && edge.kind === "pred").length,
  );
  const unresolvedPorts = useWorkspaceSelector((state) => {
    const incoming = Object.values(state.edges).find((edge) => edge.to === id);
    const outgoing = Object.values(state.edges).find((edge) => edge.from === id);
    return { incoming, outgoing };
  });
  const feedback = useNodeFeedbackContext();

  return { inMarquee, flagsState, claimed, fanIn, unresolvedPorts, feedback };
}

function useNdGraphNodeTelemetryState(id: string) {
  const telemetryOn = useTelemetrySelector((telemetry) => telemetry.enabled);
  const cooking = useTelemetrySelector((telemetry) => telemetry.cooking[id] ?? false);
  const dirty = useTelemetrySelector((telemetry) => telemetry.dirty[id] ?? false);
  const epoch = useTelemetrySelector((telemetry) => telemetry.epoch);
  const cookMs = useTelemetrySelector((telemetry) => telemetry.cookMs[id]);

  return { telemetryOn, cooking, dirty, epoch, cookMs };
}

function resolveNodeCatalogState(ws: Workspace, node: GraphDocumentNode | undefined) {
  if (!node) return { def: null, spec: undefined, hasBody: false, body: undefined };

  const def = ws.nodeLibrary.getDescriptorExact(node.definitionRef) ?? null;
  const spec = ws.nodeLibrary.getSpecExact(node.definitionRef);
  return { def, spec, hasBody: spec?.definition.load !== undefined, body: spec?.body };
}

function resolveNodeFlags(flagsState: { bypass?: boolean; off?: boolean } | undefined) {
  const bypassed = flagsState?.bypass ?? false;
  const dispOff = flagsState?.off ?? false;
  return { bypassed, dispOff, flagged: bypassed || dispOff };
}

export function useNdGraphNodeModel(id: string) {
  const ws = useWorkspace();
  const layout = useNdGraphNodeLayoutState(id);
  const graph = useNdGraphNodeGraphState(id);
  const telemetry = useNdGraphNodeTelemetryState(id);
  const updateInternals = useUpdateNodeInternals();

  const catalog = resolveNodeCatalogState(ws, layout.node);
  const form = resolveNodeForm(ws, id);
  const size = resolveNodeSize(ws, id);
  const countActive = isNodeCountActive(catalog.def, form);
  const { count, cooking: countCooking, error: countError } = useNodeCount(id, countActive);

  useEffect(() => {
    updateInternals(id);
  }, [id, form, size.w, size.h, updateInternals]);

  const staged = ws.placementOf(id) === "staged";
  const flags = resolveNodeFlags(graph.flagsState);
  const showCount = shouldShowNodeCount(catalog.def, countActive, staged);

  return {
    id,
    ws,
    ...layout,
    ...graph,
    ...telemetry,
    def: catalog.def,
    spec: catalog.spec,
    form,
    size,
    staged,
    ...flags,
    hasBody: catalog.hasBody,
    led: resolveNodeLedState({
      telemetryOn: telemetry.telemetryOn,
      flagged: flags.flagged,
      cooking: telemetry.cooking,
      dirty: telemetry.dirty,
    }),
    countText: formatNodeCount({ visible: showCount, error: countError, cooking: countCooking, count }),
    bodyMode: resolveNodeBodyMode({
      form,
      staged,
      hasBody: catalog.hasBody,
      fullscreen: layout.fullscreen,
      body: catalog.body,
    }),
  };
}

export type NdGraphNodeModel = ReturnType<typeof useNdGraphNodeModel>;
