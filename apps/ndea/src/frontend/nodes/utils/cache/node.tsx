/**
 * cache — source-agnostic live-until-cached checkpoint. UNCACHED: pass the
 * input through (a pushed sel takes over, else the AND of pred inputs).
 * CACHED: return the pinned predicate verbatim (the push→pull conversion).
 *
 * The pin state lives in the workspace (`frozenPredicates`), read here via the
 * cook host. `stamp` is still a flat `WsNode` field in U3; it migrates into the
 * config blob with the other nodes in U4.
 */

import { CacheNodeBody } from "@/core/workspace/canvas/node-extras";
import { defineWsNode, lastOfKind, passthrough } from "@/core/workspace/node-kit";

export const cacheNode = defineWsNode({
  id: "cache",
  type: "cache",
  title: "Cache",
  kind: "cache",
  // single logical input ("in") that accepts ANY cooked input — a pred edge
  // (filter/wrangle) or a sel edge (scatter lasso / table selection). The first
  // port is the rendered/primary handle (pred); the second widens the accept-set.
  inputs: [
    { id: "in", kind: "pred", label: "In" },
    { id: "in-sel", kind: "sel", label: "In" },
  ],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  engineKind: "transform",
  accent: "#f59e0b", // amber — the checkpoint accent on the minimap
  checkpoint: true, // renders the ◆ badge
  cook: (inputs, host) => {
    const frozen = host.frozenPredicate();
    return frozen !== undefined ? { kind: "pred", sql: frozen } : (lastOfKind(inputs, "sel") ?? passthrough(inputs));
  },
  Body: CacheNodeBody,
  geometry: { chipW: 148, card: { w: 236, h: 168 }, full: { w: 236, h: 168 }, canFull: false },
  stage: "canvas-only",
  inPalette: true,
});
