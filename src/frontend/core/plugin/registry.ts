/**
 * Plugin registry (PLUGIN-ARCHITECTURE §8) — one map subsuming today's
 * `DockviewShell.COMPONENTS`, `panelRegistry`'s initial literal, and the PiP
 * handle pattern. Static in-tree registration of lightweight metadata; the
 * Component loads lazily via `descriptor.load()`.
 *
 * Phase 0: the registry exists but is empty — plugins register here starting in
 * Phase 1 (`plugins/index.ts`). The typed lookup lives in `./registry-types`.
 */

import type { PluginDescriptor, PluginKind } from "./types";

const REGISTRY = new Map<string, PluginDescriptor>();

export function registerPlugin(d: PluginDescriptor): void {
  if (REGISTRY.has(d.id)) throw new Error(`duplicate plugin id: ${d.id}`);
  REGISTRY.set(d.id, d);
}

export function getPlugin(id: string): PluginDescriptor | undefined {
  return REGISTRY.get(id);
}

export function listPlugins(): PluginDescriptor[] {
  return [...REGISTRY.values()];
}

export function listByKind(k: PluginKind): PluginDescriptor[] {
  return listPlugins().filter((p) => p.kind === k);
}
