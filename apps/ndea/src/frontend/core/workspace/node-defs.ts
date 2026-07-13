/**
 * WORKSPACE_NODE_DESCRIPTORS — a DERIVED VIEW over the node registry (single source of truth is
 * now the `WorkspaceNodeSpec` in `./nodes/*.node.tsx`). It is no longer a hand-edited
 * literal: each `WorkspaceNodeDescriptor` is projected from the registered spec — identity/kind/
 * ports from the SDK base + cook spec, geometry/stage/palette from the spec's
 * canvas fields. Kept as a thin compatibility view so the ~16 existing consumers
 * (`WorkspaceCanvas`, `NdGraphNode`, `AddNodeMenu`, `port-positions`, `K1Cursor`,
 * `feedback.ts`, …) keep reading the same `WorkspaceNodeDescriptor` shape with no churn.
 *
 * Port typing: out-kind / in-kinds drive wire legality (the canvas checks
 * kind-compatibility; the engine checks cycles). `inKinds` is the full accept
 * list (a multi-accept node like `cache` declares pred+sel input ports);
 * `inKinds[0]` is the rendered handle's kind. Column/embedding references stay
 * config (gear), not wires — judged too granular.
 */

import type { NdPortKind } from "@/components/nd/nd-port";
import {
  getWorkspaceNodeSpec,
  inputPortKindsOf,
  listWorkspaceNodeSpecs,
  outputPortKindOf,
  type WorkspaceNodeSpec,
} from "./node-kit";
import type { WorkspaceNodeSize } from "./types";
import type { GraphNodeRole, GraphNodeType } from "@/core/graph/records";

export interface WorkspaceNodeDescriptor {
  type: GraphNodeType;
  kind: GraphNodeRole;
  label: string;
  /** registry plugin id backing the body (null = built-in body) */
  pluginId: string | null;
  /** chip width; card/full boxes */
  chipW: number;
  card: WorkspaceNodeSize;
  full: WorkspaceNodeSize;
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

/** Project a registered spec down to the legacy `WorkspaceNodeDescriptor` shape consumers read. */
function toWorkspaceNodeDescriptor(spec: WorkspaceNodeSpec): WorkspaceNodeDescriptor {
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
    outKind: outputPortKindOf(spec),
    inKinds: inputPortKindsOf(spec),
    stage: spec.stage,
    inPalette: spec.inPalette,
  };
}

// Per-type `WorkspaceNodeDescriptor` cache — specs are registered once at boot and never
// mutated, so a `WorkspaceNodeDescriptor` projection is stable. Memoizing keeps the Proxy `get`
// allocation-free in the canvas hot paths (K1Cursor pointer-move, minimap).
const WORKSPACE_NODE_DESCRIPTOR_CACHE = new Map<string, WorkspaceNodeDescriptor>();
function workspaceNodeDescriptorFor(type: string): WorkspaceNodeDescriptor | undefined {
  const cached = WORKSPACE_NODE_DESCRIPTOR_CACHE.get(type);
  if (cached) return cached;
  const spec = getWorkspaceNodeSpec(type);
  if (!spec) return undefined;
  const def = toWorkspaceNodeDescriptor(spec);
  WORKSPACE_NODE_DESCRIPTOR_CACHE.set(type, def);
  return def;
}

/**
 * `WORKSPACE_NODE_DESCRIPTORS[type]` — registry-backed lookup keeping the `Record` access shape.
 * Reads are lazy (resolved on first access, post-boot once specs are
 * registered) and memoized, so static `import { WORKSPACE_NODE_DESCRIPTORS }` consumers see the
 * live spec set without per-access allocation.
 */
export const WORKSPACE_NODE_DESCRIPTORS = new Proxy({} as Record<GraphNodeType, WorkspaceNodeDescriptor>, {
  get(_t, prop: string) {
    return workspaceNodeDescriptorFor(prop);
  },
  has(_t, prop: string) {
    return getWorkspaceNodeSpec(prop) !== undefined;
  },
  ownKeys() {
    return listWorkspaceNodeSpecs().map((s) => s.type);
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

/** Palette membership — the spec set filtered to `inPalette`, projected. */
export function workspacePaletteNodeDescriptors(): WorkspaceNodeDescriptor[] {
  return listWorkspaceNodeSpecs()
    .filter((s) => s.inPalette)
    .map((s) => workspaceNodeDescriptorFor(s.type)!);
}

export function workspaceNodeSize(def: WorkspaceNodeDescriptor, form: "chip" | "card" | "full"): WorkspaceNodeSize {
  if (form === "chip") return { w: def.chipW, h: 26 };
  return form === "full" ? def.full : def.card;
}
