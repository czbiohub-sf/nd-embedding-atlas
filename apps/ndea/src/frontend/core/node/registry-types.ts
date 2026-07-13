/** Typed view over the runtime descriptor registry. */

import { getDescriptor } from "./registry";
import type { NodeDescriptor } from "@ndea/sdk";

/** Plugins add their config and option types through declaration merging. */
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
