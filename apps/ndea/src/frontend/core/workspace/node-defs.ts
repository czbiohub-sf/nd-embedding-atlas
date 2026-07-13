/**
 * NODE_DEFS — a DERIVED VIEW over the node registry (single source of truth is
 * now the `WsNodeSpec` in `./nodes/*.node.tsx`). It is no longer a hand-edited
 * literal: each `NodeDef` is projected from the registered spec — identity/kind/
 * ports from the SDK base + cook spec, geometry/stage/palette from the spec's
 * canvas fields. Kept as a thin compatibility view so the ~16 existing consumers
 * (`WorkspaceCanvas`, `NdGraphNode`, `AddNodeMenu`, `port-positions`, `K1Cursor`,
 * `feedback.ts`, …) keep reading the same `NodeDef` shape with no churn.
 *
 * Port typing: out-kind / in-kinds drive wire legality (the canvas checks
 * kind-compatibility; the engine checks cycles). `inKinds` is the full accept
 * list (a multi-accept node like `cache` declares pred+sel input ports);
 * `inKinds[0]` is the rendered handle's kind. Column/embedding references stay
 * config (gear), not wires — judged too granular.
 */

import type { NdPortKind } from "@/components/nd/nd-port";
import { getWsNode, inKindsOf, listWsNodes, outKindOf, type WsNodeSpec } from "./node-kit";
import type { WH, WsNodeKind, WsNodeType } from "./types";

export interface NodeDef {
  type: WsNodeType;
  kind: WsNodeKind;
  label: string;
  /** registry plugin id backing the body (null = built-in body) */
  pluginId: string | null;
  /** chip width; card/full boxes */
  chipW: number;
  card: WH;
  full: WH;
  /** full form allowed (embedded views + the threshold filter) */
  canFull: boolean;
  hasIn: boolean;
  hasOut: boolean;
  outKind: NdPortKind;
  inKinds: NdPortKind[];
  /** plugin descriptor stage flag (M3): stageable | pin-only | canvas-only */
  stage: "stageable" | "pin-only" | "canvas-only";
  /** appears in the Tab / right-click palette */
  inPalette: boolean;
}

/** Project a registered spec down to the legacy `NodeDef` shape consumers read. */
function toNodeDef(spec: WsNodeSpec): NodeDef {
  return {
    type: spec.type,
    kind: spec.kind,
    label: spec.title,
    pluginId: spec.pluginId ?? null,
    chipW: spec.geometry.chipW,
    card: spec.geometry.card,
    full: spec.geometry.full,
    canFull: spec.geometry.canFull,
    hasIn: spec.inputs.length > 0,
    hasOut: spec.outputs.length > 0,
    outKind: outKindOf(spec),
    inKinds: inKindsOf(spec),
    stage: spec.stage,
    inPalette: spec.inPalette,
  };
}

// Per-type `NodeDef` cache — specs are registered once at boot and never
// mutated, so a `NodeDef` projection is stable. Memoizing keeps the Proxy `get`
// allocation-free in the canvas hot paths (K1Cursor pointer-move, minimap).
const DEF_CACHE = new Map<string, NodeDef>();
function defFor(type: string): NodeDef | undefined {
  const cached = DEF_CACHE.get(type);
  if (cached) return cached;
  const spec = getWsNode(type);
  if (!spec) return undefined;
  const def = toNodeDef(spec);
  DEF_CACHE.set(type, def);
  return def;
}

/**
 * `NODE_DEFS[type]` — registry-backed lookup keeping the `Record` access shape.
 * Reads are lazy (resolved on first access, post-boot once specs are
 * registered) and memoized, so static `import { NODE_DEFS }` consumers see the
 * live spec set without per-access allocation.
 */
export const NODE_DEFS = new Proxy({} as Record<WsNodeType, NodeDef>, {
  get(_t, prop: string) {
    return defFor(prop);
  },
  has(_t, prop: string) {
    return getWsNode(prop) !== undefined;
  },
  ownKeys() {
    return listWsNodes().map((s) => s.type);
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

/** Palette membership — the spec set filtered to `inPalette`, projected. */
export function paletteDefs(): NodeDef[] {
  return listWsNodes()
    .filter((s) => s.inPalette)
    .map((s) => defFor(s.type)!);
}

export function nodeSize(def: NodeDef, form: "chip" | "card" | "full"): WH {
  if (form === "chip") return { w: def.chipW, h: 26 };
  return form === "full" ? def.full : def.card;
}
