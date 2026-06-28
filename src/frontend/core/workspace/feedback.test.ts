import { describe, expect, test } from "bun:test";
import { deriveFeedbackChannels } from "./feedback";
import type { WsEdge, WsNode } from "./types";

// Minimal fixtures — the derivation reads id/type/pluginId/label + edge from/to.
// (label is unset here, so fromLabel/toLabel fall back to the node id.)
const node = (id: string, type: string, pluginId: string | null = null): WsNode =>
  ({ id, type, pluginId }) as unknown as WsNode;
const edge = (from: string, to: string): WsEdge => ({ from, to }) as unknown as WsEdge;
const byId = <T extends { id?: string } | WsEdge>(arr: T[], key: (t: T, i: number) => string) =>
  Object.fromEntries(arr.map((t, i) => [key(t, i), t]));

const isWriter = (n: WsNode) => n.type === "annotate";
const isSource = (n: WsNode) => n.type === "obs" || n.type === "dataset";

describe("deriveFeedbackChannels", () => {
  test("a wired annotate node loops back to its source ancestor", () => {
    const nodes = byId([node("obs", "obs"), node("flt", "wrangle"), node("ann", "annotate", "annotate")], (n) => n.id);
    const edges = byId([edge("obs", "flt"), edge("flt", "ann")], (_, i) => `e${i}`);
    expect(deriveFeedbackChannels(nodes, edges, isWriter, isSource)).toEqual([
      { id: "fb:ann->obs", from: "ann", to: "obs", fromLabel: "ann", toLabel: "obs", kind: "data" },
    ]);
  });

  test("an UNWIRED annotate node reaches no source → no channel", () => {
    const nodes = byId([node("obs", "obs"), node("ann", "annotate", "annotate")], (n) => n.id);
    expect(deriveFeedbackChannels(nodes, {}, isWriter, isSource)).toEqual([]);
  });

  test("non-writer nodes never produce a channel", () => {
    const nodes = byId([node("obs", "obs"), node("tbl", "table", "table")], (n) => n.id);
    const edges = byId([edge("obs", "tbl")], (_, i) => `e${i}`);
    expect(deriveFeedbackChannels(nodes, edges, isWriter, isSource)).toEqual([]);
  });
});
