import { PluginBootstrapCatalogSchema, type PluginBootstrapCatalog } from "@ndea/protocol";
import type { PluginFactory } from "@ndea/sdk";

export const PLUGIN_BOOTSTRAP_URL = "/api/plugins/bootstrap";

export type PluginBootstrapFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "statusText" | "json">>;

export type PluginModuleImporter = (url: string) => Promise<unknown>;

export async function fetchPluginBootstrap(
  fetcher: PluginBootstrapFetch = globalThis.fetch,
  url = PLUGIN_BOOTSTRAP_URL,
): Promise<PluginBootstrapCatalog> {
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Plugin bootstrap request failed (${response.status} ${response.statusText})`);
  }
  return PluginBootstrapCatalogSchema.parse(await response.json());
}

export async function importPluginFactory(url: string, importer: PluginModuleImporter): Promise<PluginFactory> {
  const moduleValue = await importer(url);
  if (!moduleValue || typeof moduleValue !== "object" || !("default" in moduleValue)) {
    throw new TypeError("Plugin client entry must export a default factory");
  }
  const factory = moduleValue.default;
  if (typeof factory !== "function") {
    throw new TypeError("Plugin client entry default export must be a factory function");
  }
  return factory as PluginFactory;
}

export const importPluginModule: PluginModuleImporter = (url) => import(/* @vite-ignore */ url);
