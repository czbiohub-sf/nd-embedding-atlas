/**
 * NdGraphNode: the single xyflow node type for the workspace. Its hooks keep
 * graph and telemetry subscriptions unconditional; render-only units project
 * the resulting model into unresolved, proxy, and standard node forms.
 */

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";

import { ProxyNdGraphNode, ResolvedNdGraphNode, UnresolvedNdGraphNode } from "./NdGraphNodeView";
import { useNdGraphNodeModel } from "./useNdGraphNodeModel";
import { useNdGraphNodeResize } from "./useNdGraphNodeResize";

export interface NdGraphNodeData {
  wsId: string;
  [key: string]: unknown;
}

export type NdGraphNodeType = Node<NdGraphNodeData, "nd">;

function NdGraphNodeInner({ id, selected }: NodeProps<NdGraphNodeType>) {
  const model = useNdGraphNodeModel(id);
  const onResize = useNdGraphNodeResize(model);

  if (!model.node) return null;
  if (!model.def) return <UnresolvedNdGraphNode model={model} selected={selected} />;
  if (model.node.definitionRef.nodeTypeId === "proxy") {
    return <ProxyNdGraphNode model={model} node={model.node} def={model.def} selected={selected} />;
  }

  return (
    <ResolvedNdGraphNode model={model} node={model.node} def={model.def} selected={selected} onResize={onResize} />
  );
}

export const NdGraphNode = memo(NdGraphNodeInner);
