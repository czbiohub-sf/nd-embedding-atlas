/**
 * Typed registry lookup (PLUGIN-ARCHITECTURE §8) — single source of truth for the
 * id → {config, options} map. `getDescriptor` erases generics at the runtime-map
 * boundary; this keeps a typed view so `<PluginMount>` / `PluginNode` can
 * type-check `node.data` against a descriptor's precise `Config`.
 *
 * `NodeTypeMap` is intentionally an INTERFACE so each plugin augments it via
 * declaration merging as it lands (Phase 2+). It is empty in Phase 0.
 */

import { getDescriptor } from "./registry";
import type { NodeDescriptor } from "./types";

/**
 * id → { config; options }. Augmented per-plugin, e.g. in `nodes/scatter/index.ts`:
 *   declare module "@/core/node/registry-types" {
 *     interface NodeTypeMap { scatter: { config: ScatterConfig; options: ScatterOptions } }
 *   }
 */
// Intentionally empty in Phase 0 — augmented per-plugin via declaration merging.
// eslint-disable-next-line typescript/no-empty-object-type
export interface NodeTypeMap {}

export type DescriptorId = keyof NodeTypeMap;

type ConfigOf<K> = K extends DescriptorId ? (NodeTypeMap[K] extends { config: infer C } ? C : unknown) : unknown;
type OptionsOf<K> = K extends DescriptorId ? (NodeTypeMap[K] extends { options: infer O } ? O : unknown) : unknown;

export function getDescriptorTyped<K extends DescriptorId>(
  id: K,
): NodeDescriptor<ConfigOf<K>, OptionsOf<K>> | undefined {
  return getDescriptor(id as string) as unknown as NodeDescriptor<ConfigOf<K>, OptionsOf<K>> | undefined;
}
