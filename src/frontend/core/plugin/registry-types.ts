/**
 * Typed registry lookup (PLUGIN-ARCHITECTURE §8) — single source of truth for the
 * id → {config, options} map. `getPlugin` erases generics at the runtime-map
 * boundary; this keeps a typed view so `<PluginMount>` / `PluginNode` can
 * type-check `node.data` against a descriptor's precise `Config`.
 *
 * `PluginTypeMap` is intentionally an INTERFACE so each plugin augments it via
 * declaration merging as it lands (Phase 2+). It is empty in Phase 0.
 */

import { getPlugin } from "./registry";
import type { PluginDescriptor } from "./types";

/**
 * id → { config; options }. Augmented per-plugin, e.g. in `plugins/scatter/index.ts`:
 *   declare module "@/core/plugin/registry-types" {
 *     interface PluginTypeMap { scatter: { config: ScatterConfig; options: ScatterOptions } }
 *   }
 */
// Intentionally empty in Phase 0 — augmented per-plugin via declaration merging.
// eslint-disable-next-line typescript/no-empty-object-type
export interface PluginTypeMap {}

export type PluginId = keyof PluginTypeMap;

type ConfigOf<K> = K extends PluginId ? (PluginTypeMap[K] extends { config: infer C } ? C : unknown) : unknown;
type OptionsOf<K> = K extends PluginId ? (PluginTypeMap[K] extends { options: infer O } ? O : unknown) : unknown;

export function getPluginTyped<K extends PluginId>(id: K): PluginDescriptor<ConfigOf<K>, OptionsOf<K>> | undefined {
  return getPlugin(id as string) as unknown as PluginDescriptor<ConfigOf<K>, OptionsOf<K>> | undefined;
}
