/**
 * Plugin registry (PLUGIN-ARCHITECTURE §8) — one map subsuming today's
 * `DockviewShell.COMPONENTS`, `panelRegistry`'s initial literal, and the PiP
 * handle pattern. Static in-tree registration of lightweight metadata; the
 * Component loads lazily via `descriptor.load()`.
 *
 * Phase 0: the registry exists but is empty — plugins register here starting in
 * Phase 1 (`plugins/index.ts`). The typed lookup lives in `./registry-types`.
 */

import type { ZodType } from "zod";
import type { NodeSpec, NodeDescriptor, DescriptorKind } from "./types";
import { SDK_VERSION, sdkMajor } from "./version";

// One registry for every node, built-in or plugin (the SDK is the single home).
// A `NodeDescriptor` IS-A `NodeSpec` (extends it transitively), so both share
// this map; `isPluginDescriptor` narrows back to the plugin shape where needed.
const REGISTRY = new Map<string, NodeSpec>();

/** A registered node is a plugin descriptor iff it carries a lazy `load()`. */
function isPluginDescriptor(s: NodeSpec): s is NodeDescriptor {
  return typeof (s as NodeDescriptor).load === "function";
}

/** A registered node is a graph-node spec iff it carries an engine `cook`. */
function hasCook(s: NodeSpec): boolean {
  return typeof (s as { cook?: unknown }).cook === "function";
}

/**
 * A plugin-backed VIEW node is two complementary halves under ONE id: the
 * graph-node spec (cook + engineKind + canvas geometry + ports, from
 * `registerNode`) and the plugin descriptor (lazy `load()` + Component +
 * capabilities, from `registerDescriptor`). When one half is registered and the
 * other already holds the id, they MERGE into a single entry rather than
 * collide. A true duplicate (two descriptors, or two graph specs) is NOT a
 * complement and still throws.
 */
function isComplement(existing: NodeSpec, incoming: NodeSpec): boolean {
  return (hasCook(existing) && isPluginDescriptor(incoming)) || (isPluginDescriptor(existing) && hasCook(incoming));
}

/**
 * Merge the two halves canonically: the descriptor (plugin body) is the base,
 * the graph spec (node identity) layered ON TOP so its ports / cook / geometry
 * win. The descriptor's `load`/`Component`/`capabilities`/`placement` survive
 * (the spec carries none); the spec's `inputs`/`outputs`/`title` win where both
 * declare them (the node-type ports are authoritative, e.g. scatter's `sel`
 * out, not the descriptor's `pred`).
 */
function mergeHalves(existing: NodeSpec, incoming: NodeSpec): NodeSpec {
  const descriptor = hasCook(existing) ? incoming : existing;
  const spec = hasCook(existing) ? existing : incoming;
  return { ...descriptor, ...spec };
}

/** Outcome of a non-throwing (runtime / external) registration attempt. */
export type RegistrationResult = { ok: true } | { ok: false; error: string };

/** Reject a descriptor whose host-API MAJOR doesn't match this build's `SDK_VERSION`. */
function versionError(d: NodeDescriptor): string | null {
  if (d.sdkVersion && sdkMajor(d.sdkVersion) !== sdkMajor(SDK_VERSION)) {
    return `plugin "${d.id}" targets sdkVersion ${d.sdkVersion}, incompatible with host ${SDK_VERSION}`;
  }
  return null;
}

/**
 * Register a STATIC (in-tree / build-time) plugin. Throws on a duplicate id or
 * an incompatible `sdkVersion` — both are author bugs that should fail the build,
 * not degrade silently. Built-ins register first (via `plugins/index.ts`), so
 * they own their ids before any runtime plugin is discovered.
 */
export function registerDescriptor<Config, Options>(d: NodeDescriptor<Config, Options>): void {
  const verr = versionError(d as unknown as NodeDescriptor);
  if (verr) throw new Error(verr);
  const existing = REGISTRY.get(d.id);
  // The map is intentionally type-erased; the typed view is `registry-types.ts`.
  // A specific descriptor (e.g. `<ScatterConfig>`) is NOT assignable to
  // `<unknown>` due to Component param contravariance, so erase at the boundary.
  const incoming = d as unknown as NodeDescriptor;
  if (existing) {
    if (!isComplement(existing, incoming)) throw new Error(`duplicate plugin id: ${d.id}`);
    // Merge with the graph spec already registered for this plugin-backed view
    // node (one id, two complementary halves).
    REGISTRY.set(d.id, mergeHalves(existing, incoming));
    return;
  }
  REGISTRY.set(d.id, incoming);
}

/**
 * Register a RUNTIME-discovered (user-authored) plugin. Unlike `registerDescriptor`
 * this NEVER throws — it returns a `RegistrationResult` the loader surfaces to
 * the user. Deterministic precedence (the spike's lesson — never silent
 * first-wins): an id already held by a built-in OR an earlier-loaded runtime
 * plugin is REJECTED (built-ins / already-loaded win), as is a major-incompatible
 * `sdkVersion`. Consumed by the (Phase 2) discovery loader.
 */
export function tryRegisterExternalDescriptor(d: NodeDescriptor): RegistrationResult {
  const verr = versionError(d);
  if (verr) return { ok: false, error: verr };
  if (REGISTRY.has(d.id)) {
    return { ok: false, error: `plugin id "${d.id}" conflicts with a built-in or already-loaded plugin` };
  }
  REGISTRY.set(d.id, d);
  return { ok: true };
}

/**
 * Register a STATIC built-in node spec (no lazy `load()` / no `sdkVersion`
 * gate — built-ins ship with the host). Throws on duplicate id, an author bug
 * that should fail the build. Built-in specs register before any runtime plugin
 * via `core/workspace/nodes/index.ts`.
 */
export function registerNode(spec: NodeSpec): void {
  const existing = REGISTRY.get(spec.id);
  if (existing) {
    if (!isComplement(existing, spec)) throw new Error(`duplicate node id: ${spec.id}`);
    // Merge onto an already-registered plugin descriptor of the same id (the
    // boot order is node-specs-first today, but the merge is order-independent).
    REGISTRY.set(spec.id, mergeHalves(existing, spec));
    return;
  }
  REGISTRY.set(spec.id, spec);
}

/** Look up any registered node (built-in or plugin) by id. */
export function getNode(id: string): NodeSpec | undefined {
  return REGISTRY.get(id);
}

/** Every registered node, built-in and plugin. */
export function listNodes(): NodeSpec[] {
  return [...REGISTRY.values()];
}

/** Every registered node id — the runtime source of truth for fitness checks. */
export function allNodeIds(): string[] {
  return [...REGISTRY.keys()];
}

/**
 * Validate a node's serializable `config` against its spec schema. Configless
 * specs pass the raw value through. The single choke point a future document-
 * load path validates through (parse-on-construct, parse-on-load).
 */
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
