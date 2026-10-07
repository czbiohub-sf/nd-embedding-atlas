/**
 * Canvas views of coordination: a hub per scope and a link per binding (see
 * `scope-links.ts`). Hubs are derived from the document, so they cannot be
 * dragged or deleted; links delete by clearing their binding.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  useConnection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo } from "react";

import { COORDINATION_TYPE_IDS, COORDINATION_TYPES, type CoordinationTypeId } from "@/core/coordination/types";
import { useWorkspace, useWorkspaceSelector } from "../workspace-context";
import { parseScopeHubId, parseScopeLinkId, SCOPE_HANDLE } from "./scope-links";

export type ScopeHubNodeType = Node<{ type: CoordinationTypeId; scope: string }, "scopehub">;
export type ScopeLinkEdgeType = Edge<{ scope: string }, "scopelink">;

function ScopeHubNodeInner({ id, data }: NodeProps<ScopeHubNodeType>) {
  const ws = useWorkspace();
  const color = ws.coordination.scopeColor(data.scope);
  return (
    <div
      className="flex h-[22px] items-center gap-1.5 rounded-full border bg-card px-2 font-mono text-[9.5px] whitespace-nowrap"
      style={{ borderColor: color, color }}
      title={`${COORDINATION_TYPES[data.type].label} scope ${data.scope}: drag to a node to link it`}
      data-scope-hub={id}
    >
      {COORDINATION_TYPES[data.type].label} · {data.scope}
      <Handle
        type="source"
        position={Position.Bottom}
        id={SCOPE_HANDLE}
        style={{ width: 9, height: 9, minWidth: 0, minHeight: 0, background: color, border: "none", bottom: -5 }}
      />
    </div>
  );
}

export const ScopeHubNode = memo(ScopeHubNodeInner);

function ScopeLinkEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<ScopeLinkEdgeType>) {
  const ws = useWorkspace();
  const color = ws.coordination.scopeColor(data?.scope ?? "");
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={11}
        style={{ stroke: color, strokeWidth: selected ? 2.2 : 1.3, strokeDasharray: "3 4", opacity: 0.85 }}
      />
      {selected ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="unlink from this scope"
            className="nodrag nopan pointer-events-auto absolute z-[9] size-[18px] cursor-pointer rounded-full border border-destructive/70 bg-card p-0 text-[10px] leading-none text-destructive"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={(e) => {
              e.stopPropagation();
              const link = parseScopeLinkId(id);
              if (link) ws.coordination.clearScope(link.node, link.type);
            }}
          >
            ✕
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const ScopeLinkEdge = memo(ScopeLinkEdgeInner);

/**
 * The target end of scope links on a node; glows while a legal hub drag is in
 * flight. Present when the node can join a scope or already has a binding, so
 * every binding the document holds (even one an agent wrote for a node that
 * cannot use it) projects to a visible, deletable link.
 */
export function ScopeTargetHandle({ nodeId }: { readonly nodeId: string }) {
  const ws = useWorkspace();
  const conn = useConnection();
  // capabilities follow the node's definition; re-render when it is retyped
  useWorkspaceSelector((s) => s.nodes[nodeId]?.definitionRef);
  const bound = useWorkspaceSelector((s) => s.bindings[nodeId] !== undefined);
  if (!bound && !COORDINATION_TYPE_IDS.some((type) => ws.canBindScope(nodeId, type))) return null;
  const hub = conn.inProgress && conn.fromNode ? parseScopeHubId(conn.fromNode.id) : null;
  const legal = hub ? ws.canLinkScope(nodeId, hub.type, hub.scope) : false;
  return (
    <Handle
      type="target"
      position={Position.Top}
      id={SCOPE_HANDLE}
      isConnectableStart={false}
      style={{
        width: 9,
        height: 9,
        minWidth: 0,
        minHeight: 0,
        top: -5,
        background: "var(--card)",
        border: "1.5px dashed var(--color-text-muted)",
        boxShadow: legal ? "var(--shadow-legal-ring)" : "none",
        opacity: hub && !legal ? 0.3 : 1,
      }}
    />
  );
}
