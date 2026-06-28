/**
 * Memoized plugin-module loader — each plugin's engine chunk is fetched at most
 * once per session. Shared by every mount surface (Dockview panel via
 * `<PluginMount>`, float, graph node body).
 */

import { getDescriptor } from "./registry";
import type { NodeModule } from "./types";

const moduleCache = new Map<string, Promise<NodeModule>>();

export function loadNodeModule(id: string): Promise<NodeModule> {
  let p = moduleCache.get(id);
  if (!p) {
    const descriptor = getDescriptor(id);
    if (!descriptor) return Promise.reject(new Error(`unknown plugin: ${id}`));
    p = descriptor.load();
    moduleCache.set(id, p);
  }
  return p;
}
