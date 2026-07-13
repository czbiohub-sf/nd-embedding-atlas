/** Catalog-scoped lazy module loading shared by every mount surface in one session. */

import type { ExactNodeTypeRef, NodeTypeId } from "@ndea/sdk";
import type { NodeCatalog } from "@/core/plugin/catalog";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";

type CatalogNodeModule = Awaited<ReturnType<NonNullable<CatalogNodeDefinition["load"]>>>;

const MODULE_CACHE = new WeakMap<NodeCatalog, Map<CatalogNodeDefinition, Promise<CatalogNodeModule>>>();

export function loadNodeModule(
  catalog: NodeCatalog,
  ref: ExactNodeTypeRef | NodeTypeId | string,
): Promise<CatalogNodeModule> {
  const definition = typeof ref === "string" ? catalog.resolveCurrent(ref) : catalog.resolveExact(ref);
  if (!definition) {
    const label = typeof ref === "string" ? ref : `${ref.nodeTypeId}@${ref.nodeTypeVersion}`;
    return Promise.reject(new Error(`node definition not found: ${label}`));
  }
  if (!definition.load) {
    const { nodeTypeId, nodeTypeVersion } = definition.ref;
    return Promise.reject(new Error(`node definition has no module: ${nodeTypeId}@${nodeTypeVersion}`));
  }

  let cache = MODULE_CACHE.get(catalog);
  if (!cache) {
    cache = new Map();
    MODULE_CACHE.set(catalog, cache);
  }

  let modulePromise = cache.get(definition);
  if (!modulePromise) {
    modulePromise = definition.load();
    cache.set(definition, modulePromise);
  }
  return modulePromise;
}
