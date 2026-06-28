/**
 * Feedback channels — the relationships the DAG can't express.
 *
 * The GraphEngine is acyclic (no edge may close a cycle), but some nodes' output
 * re-enters an UPSTREAM node's input with no forward edge — they "feed back into
 * where they came from." The first such channel is the DATA loop: a node with a
 * data-writing capability (`annotate`) writes a column into the shared `dataset`,
 * which the SOURCE node it descends from now carries. So `writer → source`,
 * derived purely from topology + capability — no runtime state, no plugin hooks.
 *
 * The canvas renders these as wireless badges (a matched ↻ pair) rather than a
 * backward wire. The selection loop (lasso re-filtering its source) is the same
 * shape and will register as a second `kind` once workspace selection-looping is
 * enabled — today it's suppressed, so it isn't derived here.
 */

import { createContext, useContext, useMemo } from "react";
import { getDescriptor } from "@/core/node/registry";
import { NODE_DEFS } from "./node-defs";
import { useWsSelector } from "./workspace-context";
import type { WsEdge, WsNode } from "./types";

export interface FeedbackChannel {
  /** Stable id: `fb:<from>-><to>`. */
  id: string;
  /** The data-writing node (emitter). */
  from: string;
  /** The source node the written data re-enters (receiver). */
  to: string;
  /** Resolved labels (baked at derivation so badges need no node-map lookup). */
  fromLabel: string;
  toLabel: string;
  kind: "data";
}

/** Capabilities whose output mutates the shared dataset (v1: annotation only;
 *  `schema-mutate` / categorize is a candidate to add once it's not noisy). */
const DATA_WRITE_CAPS = ["annotate"] as const;

/**
 * Pure derivation: for each data-writing node, walk UPSTREAM to the source
 * node(s) it descends from and emit a `writer → source` channel. An unwired
 * writer reaches no source → no channel (so feedback only shows once it's
 * actually plumbed into the data). `isWriter` / `isSource` are injected so this
 * stays free of the registry + NODE_DEFS for testing.
 */
export function deriveFeedbackChannels(
  nodes: Record<string, WsNode>,
  edges: Record<string, WsEdge>,
  isWriter: (n: WsNode) => boolean,
  isSource: (n: WsNode) => boolean,
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

function isDataWriter(n: WsNode): boolean {
  if (!n.pluginId) return false;
  const caps = getDescriptor(n.pluginId)?.capabilities;
  return caps != null && DATA_WRITE_CAPS.some((c) => caps.has(c));
}

function isSourceNode(n: WsNode): boolean {
  return NODE_DEFS[n.type]?.kind === "source";
}

/**
 * Live feedback channels for the current graph; recomputed only when the node or
 * edge map changes (drags touch `s.positions`, not `s.nodes`, so this is stable
 * during pan/drag). Call ONCE at the canvas level and share via context — a
 * per-node call would re-run this whole-graph DFS N times (O(N·E) per topology
 * change). NdGraphNode reads its channels through `useNodeFeedbackContext`.
 */
export function useFeedbackChannels(): FeedbackChannel[] {
  const nodes = useWsSelector((s) => s.nodes);
  const edges = useWsSelector((s) => s.edges);
  return useMemo(() => deriveFeedbackChannels(nodes, edges, isDataWriter, isSourceNode), [nodes, edges]);
}

/** Canvas-level context: the single derived channel set, read by each node. */
export const FeedbackChannelsContext = createContext<readonly FeedbackChannel[]>([]);

/** The shared feedback channels for the current canvas (empty outside a canvas). */
export function useNodeFeedbackContext(): readonly FeedbackChannel[] {
  return useContext(FeedbackChannelsContext);
}
