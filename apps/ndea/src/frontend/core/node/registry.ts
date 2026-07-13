/** Unified registry for built-in node specs and lazy plugin descriptors. */

import type { ZodType } from "zod";
import { SDK_VERSION, sdkMajor, type DescriptorKind, type NodeDescriptor, type NodeSpec } from "@ndea/sdk";

const REGISTRY = new Map<string, NodeSpec>();

function isPluginDescriptor(s: NodeSpec): s is NodeDescriptor {
  return "load" in s && typeof s.load === "function";
}

function hasCook(s: NodeSpec): boolean {
  return "cook" in s && typeof s.cook === "function";
}

/** Plugin-backed views combine one graph spec with one lazy descriptor. */
function isComplement(existing: NodeSpec, incoming: NodeSpec): boolean {
  return (hasCook(existing) && isPluginDescriptor(incoming)) || (isPluginDescriptor(existing) && hasCook(incoming));
}

/** Graph identity and ports override descriptor metadata on conflicts. */
function mergeHalves(existing: NodeSpec, incoming: NodeSpec): NodeSpec {
  const descriptor = hasCook(existing) ? incoming : existing;
  const spec = hasCook(existing) ? existing : incoming;
  return { ...descriptor, ...spec };
}

export type RegistrationResult = { ok: true } | { ok: false; error: string };

function versionError(d: NodeDescriptor): string | null {
  if (d.sdkVersion && sdkMajor(d.sdkVersion) !== sdkMajor(SDK_VERSION)) {
    return `plugin "${d.id}" targets sdkVersion ${d.sdkVersion}, incompatible with host ${SDK_VERSION}`;
  }
  return null;
}

/** Registers an in-tree descriptor and throws on authoring errors. */
export function registerDescriptor<Config, Options>(d: NodeDescriptor<Config, Options>): void {
  const verr = versionError(d as unknown as NodeDescriptor);
  if (verr) throw new Error(verr);
  const existing = REGISTRY.get(d.id);
  // Component parameter variance requires erasing descriptor generics at the map boundary.
  const incoming = d as unknown as NodeDescriptor;
  if (existing) {
    if (!isComplement(existing, incoming)) throw new Error(`duplicate plugin id: ${d.id}`);
    REGISTRY.set(d.id, mergeHalves(existing, incoming));
    return;
  }
  REGISTRY.set(d.id, incoming);
}

/** Runtime registration reports conflicts instead of throwing. */
export function tryRegisterExternalDescriptor(d: NodeDescriptor): RegistrationResult {
  const verr = versionError(d);
  if (verr) return { ok: false, error: verr };
  if (REGISTRY.has(d.id)) {
    return { ok: false, error: `plugin id "${d.id}" conflicts with a built-in or already-loaded plugin` };
  }
  REGISTRY.set(d.id, d);
  return { ok: true };
}

export function registerNode(spec: NodeSpec): void {
  const existing = REGISTRY.get(spec.id);
  if (existing) {
    if (!isComplement(existing, spec)) throw new Error(`duplicate node id: ${spec.id}`);
    REGISTRY.set(spec.id, mergeHalves(existing, spec));
    return;
  }
  REGISTRY.set(spec.id, spec);
}

export function getNode(id: string): NodeSpec | undefined {
  return REGISTRY.get(id);
}

export function listNodes(): NodeSpec[] {
  return [...REGISTRY.values()];
}

export function allNodeIds(): string[] {
  return [...REGISTRY.keys()];
}

/** Validates persisted configuration before it enters runtime state. */
export function parseConfig<C>(
  spec: { config?: ZodType<C> },
  raw: unknown,
): { ok: true; value: C } | { ok: false; error: string } {
  if (!spec.config) return { ok: true, value: raw as C };
  const res = spec.config.safeParse(raw);
  return res.success ? { ok: true, value: res.data } : { ok: false, error: res.error.message };
}

export function getDescriptor(id: string): NodeDescriptor | undefined {
  const s = REGISTRY.get(id);
  return s && isPluginDescriptor(s) ? s : undefined;
}

export function listDescriptors(): NodeDescriptor[] {
  return [...REGISTRY.values()].filter(isPluginDescriptor);
}

export function listByKind(k: DescriptorKind): NodeDescriptor[] {
  return listDescriptors().filter((p) => p.kind === k);
}
