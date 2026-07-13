/**
 * Derives backward data relationships that cannot be represented as DAG edges.
 * The canvas renders them as paired wireless badges.
 */

import { createContext, useContext, useMemo } from "react";
import { getDefinition } from "@/core/node/registry";
import { WORKSPACE_NODE_DESCRIPTORS } from "./node-defs";
import { useWorkspaceSelector } from "./workspace-context";
import type { GraphDocumentEdge, GraphDocumentNode } from "@/core/graph/records";

export interface FeedbackChannel {
  id: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  kind: "data";
}

const DATA_WRITE_CAPS = ["annotation-write"] as const;

/**
 * Pure derivation: for each data-writing node, walk UPSTREAM to the source
 * node(s) it descends from and emit a `writer → source` channel. An unwired
 * writer reaches no source → no channel (so feedback only shows once it's
 * actually plumbed into the data). `isWriter` / `isSource` are injected so this
 * stays free of the registry + WORKSPACE_NODE_DESCRIPTORS for testing.
 */
export function deriveFeedbackChannels(
  nodes: Record<string, GraphDocumentNode>,
  edges: Record<string, GraphDocumentEdge>,
  isWriter: (n: GraphDocumentNode) => boolean,
  isSource: (n: GraphDocumentNode) => boolean,
): FeedbackChannel[] {
  const upstream = new Map<string, string[]>();
  for (const e of Object.values(edges)) {
    const arr = upstream.get(e.to);
    if (arr) arr.push(e.from);
    else upstream.set(e.to, [e.from]);
  }

  const channels: FeedbackChannel[] = [];
  for (const n of Object.values(nodes)) {
    if (!isWriter(n)) continue;
    const seen = new Set<string>();
    const stack = [...(upstream.get(n.id) ?? [])];
    const sources = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const cn = nodes[cur];
      if (cn && isSource(cn)) sources.add(cur);
      for (const up of upstream.get(cur) ?? []) stack.push(up);
    }
    for (const s of sources)
      channels.push({
        id: `fb:${n.id}->${s}`,
        from: n.id,
        to: s,
        fromLabel: nodes[n.id]?.label ?? n.id,
        toLabel: nodes[s]?.label ?? s,
        kind: "data",
      });
  }
  return channels;
}

function isDataWriter(n: GraphDocumentNode): boolean {
  if (!n.pluginId) return false;
  const caps = getDefinition(n.pluginId)?.capabilities;
  return caps != null && DATA_WRITE_CAPS.some((capability) => caps.includes(capability));
}

function isSourceNode(n: GraphDocumentNode): boolean {
  return WORKSPACE_NODE_DESCRIPTORS[n.type]?.kind === "source";
}

/**
 * Live feedback channels for the current graph; recomputed only when the node or
 * edge map changes (drags touch `s.positions`, not `s.nodes`, so this is stable
 * during pan/drag). Call ONCE at the canvas level and share via context — a
 * per-node call would re-run this whole-graph DFS N times (O(N·E) per topology
 * change). NdGraphNode reads its channels through `useNodeFeedbackContext`.
 */
export function useFeedbackChannels(): FeedbackChannel[] {
  const nodes = useWorkspaceSelector((s) => s.nodes);
  const edges = useWorkspaceSelector((s) => s.edges);
  return useMemo(() => deriveFeedbackChannels(nodes, edges, isDataWriter, isSourceNode), [nodes, edges]);
}

/** Canvas-level context: the single derived channel set, read by each node. */
export const FeedbackChannelsContext = createContext<readonly FeedbackChannel[]>([]);

/** The shared feedback channels for the current canvas (empty outside a canvas). */
export function useNodeFeedbackContext(): readonly FeedbackChannel[] {
  return useContext(FeedbackChannelsContext);
}
