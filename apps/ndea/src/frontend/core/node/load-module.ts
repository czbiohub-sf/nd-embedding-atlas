/**
 * Memoized plugin-module loader — each plugin's engine chunk is fetched at most
 * once per session. Shared by every mount surface (Dockview panel via
 * `<PluginMount>`, float, graph node body).
 */

import { getDefinition } from "./registry";
import type { NodeModule } from "@ndea/sdk";

const moduleCache = new Map<string, Promise<NodeModule>>();

export function loadNodeModule(id: string): Promise<NodeModule> {
  let p = moduleCache.get(id);
  if (!p) {
    const definition = getDefinition(id);
    if (!definition?.load) return Promise.reject(new Error(`node definition has no module: ${id}`));
    p = definition.load();
    moduleCache.set(id, p);
  }
  return p;
}
