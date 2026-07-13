/** Workspace-specific engine and canvas extensions to the SDK node contract. */

import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { NdPortKind } from "@/components/nd/nd-port";
import { andPreds, type CookFn, type GraphEngine, type Predicate } from "@/core/graph/engine";
import { getNode, listNodes } from "@/core/node/registry";
import { defineNode, type JsonValue, type NodeSpec } from "@ndea/sdk";
import type { Metadata } from "@/types";
import type { WH, WsNode, WsNodeKind, WsNodeType, WsValue } from "./types";

export function nodeConfig<C extends object>(node: WsNode | undefined): Partial<C> {
  return (node?.config as Partial<C> | undefined) ?? {};
}

export function patchConfig(node: WsNode | undefined, patch: Record<string, JsonValue>): JsonValue {
  return { ...(node?.config as Record<string, JsonValue> | undefined), ...patch };
}

export const PRED_NULL: WsValue = { kind: "pred", sql: null };

export function sqlOf(v: WsValue | undefined): string | null {
  return !v || v.kind === "focus" ? null : v.sql;
}

export function predSqls(inputs: ReadonlyMap<string, readonly WsValue[]>): Predicate[] {
  return [...inputs.values()].flat().map((v) => sqlOf(v));
}

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

export function passthrough(inputs: ReadonlyMap<string, readonly WsValue[]>): WsValue {
  return { kind: "pred", sql: andPreds(predSqls(inputs)) };
}

export function setConsuming(inputs: ReadonlyMap<string, readonly WsValue[]>): WsValue {
  return lastOfKind(inputs, "sel") ?? passthrough(inputs);
}

export function andWith(inputs: ReadonlyMap<string, readonly WsValue[]>, extra: Predicate): WsValue {
  return { kind: "pred", sql: andPreds([...predSqls(inputs), extra]) };
}

export interface NodeCookHost {
  readonly id: string;
  node(): WsNode | undefined;
  frozenPredicate(): string | null | undefined;
  wranglePred(): string | null;
  collectionBinding(): { id: string; version: number } | undefined;
}

export type WsCookFn = (inputs: ReadonlyMap<string, readonly WsValue[]>, host: NodeCookHost) => WsValue;

export interface NodeGeometry {
  chipW: number;
  card: WH;
  full: WH;
  canFull: boolean;
}

export interface EngineRegisterCtx {
  readonly id: string;
  readonly coordinator: unknown;
  readonly table: string;
  readonly metadata: Metadata;
  addNode(kind: "source" | "transform" | "view", cook: CookFn<WsValue>): void;
  markDirty(): void;
  onDispose(fn: () => void): void;
  setTransformHost(host: unknown): void;
  readonly engine: GraphEngine<WsValue>;
}

export interface WsNodeSpec<C = unknown> extends NodeSpec {
  config?: ZodType<C>;
  type: WsNodeType;
  kind: WsNodeKind;
  pluginId?: string | null;
  engineKind: "source" | "transform" | "view";
  cook: WsCookFn;
  registerEngine?(ctx: EngineRegisterCtx): void;
  Body?: ComponentType<{ node: WsNode }>;
  geometry: NodeGeometry;
  stage: "stageable" | "pin-only" | "canvas-only";
  inPalette: boolean;
  accent?: string;
  checkpoint?: boolean;
}

export function inKindsOf(spec: NodeSpec): NdPortKind[] {
  return spec.inputs.map((p) => p.kind as NdPortKind);
}
export function outKindOf(spec: NodeSpec): NdPortKind {
  return (spec.outputs[0]?.kind as NdPortKind) ?? "pred";
}

export function defineWsNode<C>(spec: WsNodeSpec<C>): WsNodeSpec<C> {
  return defineNode(spec);
}

export function isWsNodeSpec(s: NodeSpec | undefined): s is WsNodeSpec {
  return !!s && typeof (s as WsNodeSpec).cook === "function";
}

export function getWsNode(type: string): WsNodeSpec | undefined {
  const s = getNode(type);
  return isWsNodeSpec(s) ? s : undefined;
}

export function listWsNodes(): WsNodeSpec[] {
  return listNodes().filter(isWsNodeSpec);
}
