/**
 * cache — source-agnostic live-until-cached checkpoint. UNCACHED: pass the
 * input through (a pushed sel takes over, else the AND of pred inputs).
 * CACHED: return the pinned predicate verbatim (the push→pull conversion).
 */

import { defineNode, exactNodeTypeRef } from "@ndea/sdk";

import { lastPortValueOfKind, passthroughGraphPredicate } from "@/core/graph/cook";
import { defineNativeNodeContribution, type NativeNodeContribution } from "@/core/node/native-contribution";
import { mountReactNodeBody } from "@/core/node/react-node-body";

const cacheDefinition = defineNode({
  ref: exactNodeTypeRef("cache", "1.0.0"),
  title: "Cache",
  role: "transform",
  inputs: [
    { id: "in", kind: "pred", label: "In" },
    { id: "in-sel", kind: "sel", label: "In" },
  ],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  capabilities: [],
  load: async () => {
    // NodeDefinition.load is the intentional lazy plugin-module boundary.
    const { CacheBody } = await import("./body");
    return { mountBody: (host) => mountReactNodeBody(CacheBody, host, "Cache") };
  },
});

const selectionDefinition = defineNode({
  ...cacheDefinition,
  ref: exactNodeTypeRef("selection", "1.0.0"),
  title: "Selection",
});

const cacheCook: NativeNodeContribution["graph"]["cook"] = (inputs, host) => {
  const frozen = host.frozenPredicate();
  return frozen !== undefined
    ? { kind: "pred", sql: frozen }
    : (lastPortValueOfKind(inputs, "sel") ?? passthroughGraphPredicate(inputs));
};

export const cacheNode = defineNativeNodeContribution({
  definition: cacheDefinition,
  graph: {
    role: "cache",
    evaluationRole: "transform",
    cook: cacheCook,
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 236, h: 168 }, full: { w: 236, h: 168 }, canFull: false },
    stage: "canvas-only",
    inPalette: true,
    accent: "#f59e0b",
    checkpoint: true,
    body: "card-and-full",
  },
});

/** Persisted v2 compatibility definition; intentionally omitted from the palette. */
export const selectionNode = defineNativeNodeContribution({
  definition: selectionDefinition,
  graph: {
    role: "selection",
    evaluationRole: "transform",
    cook: cacheCook,
  },
  presentation: {
    geometry: { chipW: 148, card: { w: 232, h: 164 }, full: { w: 232, h: 164 }, canFull: false },
    stage: "canvas-only",
    inPalette: false,
    accent: "#f59e0b",
    checkpoint: true,
    body: "card-and-full",
  },
});
