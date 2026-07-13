/**
 * Memoized plugin-module loader — each plugin's executable chunk is fetched at most
 * once per session and shared by every mount surface.
 */

import { getDefinition } from "./registry";
import type { NodeModule } from "@ndea/sdk";

const moduleCache = new Map<string, Promise<NodeModule>>();

export function loadNodeModule(id: string): Promise<NodeModule> {
  let modulePromise = moduleCache.get(id);
  if (!modulePromise) {
    const definition = getDefinition(id);
    if (!definition?.load) return Promise.reject(new Error(`node definition has no module: ${id}`));
    modulePromise = definition.load();
    moduleCache.set(id, modulePromise);
  }
  return modulePromise;
}
