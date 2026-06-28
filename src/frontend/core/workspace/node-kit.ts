/**
 * Workspace node contract — the engine/canvas-coupled half of the node
 * definition that the SDK base (`NodeSpec`) deliberately leaves out.
 *
 * `WsNodeSpec` extends the SDK `NodeSpec` with the bits that resolve only here:
 * the engine `cook` (produces a `WsValue`), the engine kind, and the canvas
 * `Body`. Built-in node spec files (`./nodes/*.node.tsx`) implement this and
 * self-register into the shared SDK registry via `registerBuiltinNodes`.
 *
 * The cook reads per-node runtime state through a lightweight `NodeCookHost` —
 * the workspace-scoped counterpart to the heavy `NodeHost` (no Mosaic client,
 * GPU lease, or cross-view buses; a built-in cook needs none of that). The
 * cook-composition helpers (`predSqls`, `lastOfKind`, `sqlOf`, `PRED_NULL`)
 * live here too so spec files and `workspace-store` share one vocabulary
 * without importing each other (avoids a cycle).
 */

import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { NdPortKind } from "@/components/nd/nd-port";
import { andPreds, type CookFn, type GraphEngine, type Predicate } from "@/core/graph/engine";
import type { JsonValue } from "@/core/node/json";
import { getNode, listNodes } from "@/core/node/registry";
import type { NodeSpec } from "@/core/node/sdk";
import type { Metadata } from "@/types";
import type { WH, WsNode, WsNodeKind, WsNodeType, WsValue } from "./types";

/** Read a node's typed config from the loosely-stored `config` blob. */
export function nodeConfig<C extends object>(node: WsNode | undefined): Partial<C> {
  return (node?.config as Partial<C> | undefined) ?? {};
}

/** Merge a patch into a node's config blob (for the store's setState writers). */
export function patchConfig(node: WsNode | undefined, patch: Record<string, JsonValue>): JsonValue {
  return { ...(node?.config as Record<string, JsonValue> | undefined), ...patch };
}

/** A pred value carrying no predicate ("everything"). */
export const PRED_NULL: WsValue = { kind: "pred", sql: null };

/** the SQL a value carries toward a Mosaic Selection (focus carries none) */
export function sqlOf(v: WsValue | undefined): string | null {
  return !v || v.kind === "focus" ? null : v.sql;
}

/** every input value's SQL, flattened across ports (fan-in order). */
export function predSqls(inputs: ReadonlyMap<string, readonly WsValue[]>): Predicate[] {
  return [...inputs.values()].flat().map((v) => sqlOf(v));
}

/** the latest input value of a given kind (push wires: last-write-wins). */
export function lastOfKind<K extends WsValue["kind"]>(
  inputs: ReadonlyMap<string, readonly WsValue[]>,
  kind: K,
): Extract<WsValue, { kind: K }> | undefined {
  const flat = [...inputs.values()].flat();
  for (let i = flat.length - 1; i >= 0; i--) {
    if (flat[i].kind === kind) return flat[i] as Extract<WsValue, { kind: K }>;
  }
  return undefined;
}

/** AND-composed pass-through — the default cook for pred views/sinks/proxies. */
export function passthrough(inputs: ReadonlyMap<string, readonly WsValue[]>): WsValue {
  return { kind: "pred", sql: andPreds(predSqls(inputs)) };
}

/** set-consuming cook — a pushed sel takes over, else the AND of pred inputs. */
export function setConsuming(inputs: ReadonlyMap<string, readonly WsValue[]>): WsValue {
  return lastOfKind(inputs, "sel") ?? passthrough(inputs);
}

/** AND the pred inputs with one extra predicate (the node's own). */
export function andWith(inputs: ReadonlyMap<string, readonly WsValue[]>, extra: Predicate): WsValue {
  return { kind: "pred", sql: andPreds([...predSqls(inputs), extra]) };
}

/**
 * Runtime context a built-in node's cook reads from. Workspace-scoped and
 * lightweight; built from `workspace-store` per node, closed over its state
 * maps. Reads are live (called fresh on every cook).
 */
export interface NodeCookHost {
  readonly id: string;
  /** this node's current document record (config / flat fields). */
  node(): WsNode | undefined;
  /** pinned predicate for a cache/checkpoint node; `undefined` when live (not pinned). */
  frozenPredicate(): string | null | undefined;
  /** a wrangle node's compiled predicate, or null. */
  wranglePred(): string | null;
  /** a collection node's binding (id + version), or undefined. */
  collectionBinding(): { id: string; version: number } | undefined;
}

/** engine cook for a node spec — composes inputs into its output value. */
export type WsCookFn = (inputs: ReadonlyMap<string, readonly WsValue[]>, host: NodeCookHost) => WsValue;

/**
 * Canvas geometry per node form — the xyflow-coupled box sizes (KTD4: read by
 * the canvas layer, NOT the SDK base / engine). Lives on `WsNodeSpec` here in
 * the workspace layer, never on `core/node/NodeSpec`.
 */
export interface NodeGeometry {
  /** chip width (chip height is canonical 26px). */
  chipW: number;
  card: WH;
  full: WH;
  /** full form allowed (embedded views + the threshold filter). */
  canFull: boolean;
}

/**
 * Workspace context the `registerEngine` escape hatch receives — the minimal
 * workspace plumbing an instance-driven node (the threshold transform) needs to
 * register itself with the engine. Mirrors the `makeTransformHost` seam (KTD3);
 * keeps the plugin-specific wiring in the spec file while the workspace owns the
 * primitives (coordinator, disposers, dirty propagation).
 */
export interface EngineRegisterCtx {
  readonly id: string;
  readonly coordinator: unknown;
  readonly table: string;
  readonly metadata: Metadata;
  /** register this node's engine cook (kind + cook). */
  addNode(kind: "source" | "transform" | "view", cook: CookFn<WsValue>): void;
  /** mark this node dirty (re-cook downstream) — e.g. after a config patch. */
  markDirty(): void;
  /** register a disposer run on node removal / workspace dispose. */
  onDispose(fn: () => void): void;
  /** stash a per-node transform host so the body can render its plugin Component. */
  setTransformHost(host: unknown): void;
  readonly engine: GraphEngine<WsValue>;
}

/**
 * The unified node contract — every node, built-in or plugin-backed, is one
 * `WsNodeSpec`. It extends the SDK base (`NodeSpec`: id/title/ports/config) with
 * the workspace/canvas-coupled half the base deliberately leaves out: the
 * engine `cook` + `engineKind`, the canvas `Body`, the canvas geometry/flags
 * (KTD4 — mapped by the canvas, not the SDK base), and the `pluginId` that backs
 * a plugin view's body. `NODE_DEFS` is now a derived view over these specs
 * (`node-defs.ts`); the cook + body switches are gone (registry lookups).
 */
export interface WsNodeSpec<C = unknown> extends NodeSpec {
  config?: ZodType<C>;
  type: WsNodeType;
  kind: WsNodeKind;
  /** registry plugin id backing the body (null/undefined = built-in body). */
  pluginId?: string | null;
  /** GraphEngine node kind — drives dirty propagation / sink registration. */
  engineKind: "source" | "transform" | "view";
  cook: WsCookFn;
  /**
   * Escape hatch for instance-driven engine registration (threshold transform):
   * when present, the workspace hands it `EngineRegisterCtx` and the spec owns
   * `engine.addNode` itself (plus disposers / host stash). Plain `cook` nodes
   * leave this unset. The SINGLE documented residue of plugin-cook convergence.
   */
  registerEngine?(ctx: EngineRegisterCtx): void;
  /** canvas body (eager, lightweight); omit for plugin-backed / body-less nodes. */
  Body?: ComponentType<{ node: WsNode }>;
  /** canvas geometry (KTD4 — read by the canvas, not the engine). */
  geometry: NodeGeometry;
  /** placement: stageable | pin-only | canvas-only. */
  stage: "stageable" | "pin-only" | "canvas-only";
  /** appears in the Tab / right-click palette. */
  inPalette: boolean;
  /** canvas-facing (KTD4): minimap accent. */
  accent?: string;
  /** canvas-facing: marks a checkpoint-style node (renders the ◆ badge). */
  checkpoint?: boolean;
}

/** derived port helpers — the SDK `inputs`/`outputs` are the port source of truth. */
export function inKindsOf(spec: NodeSpec): NdPortKind[] {
  return spec.inputs.map((p) => p.kind as NdPortKind);
}
export function outKindOf(spec: NodeSpec): NdPortKind {
  return (spec.outputs[0]?.kind as NdPortKind) ?? "pred";
}

/** identity author helper for a node spec (parallels `defineDescriptor`). */
export function defineWsNode<C>(spec: WsNodeSpec<C>): WsNodeSpec<C> {
  return spec;
}

/** A registered node is a `WsNodeSpec` iff it carries a `cook`. */
export function isWsNodeSpec(s: NodeSpec | undefined): s is WsNodeSpec {
  return !!s && typeof (s as WsNodeSpec).cook === "function";
}

/** Look up a node spec by type, narrowing away plugin descriptors. */
export function getWsNode(type: string): WsNodeSpec | undefined {
  const s = getNode(type);
  return isWsNodeSpec(s) ? s : undefined;
}

/** Every registered `WsNodeSpec` (built-in + plugin-backed graph nodes). */
export function listWsNodes(): WsNodeSpec[] {
  return listNodes().filter(isWsNodeSpec);
}
