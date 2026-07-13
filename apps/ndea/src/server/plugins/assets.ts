import { extname } from "node:path";
import {
  PLUGIN_BOOTSTRAP_SCHEMA_VERSION,
  PluginBootstrapCatalogSchema,
  type PluginBootstrapCatalog,
  type PluginBootstrapEntry,
} from "@ndea/protocol";
import type { ValidatedPluginRoot } from "./discovery.ts";

export interface PluginAsset {
  body: Blob;
  contentType: string;
}

export interface PluginRuntimeSnapshot {
  catalog: PluginBootstrapCatalog;
  assets: Readonly<Record<string, PluginAsset>>;
}

export function createPluginRuntimeSnapshot(
  plugins: readonly ValidatedPluginRoot[],
  diagnostics: PluginBootstrapCatalog["diagnostics"],
): PluginRuntimeSnapshot {
  const entries: PluginBootstrapEntry[] = [];
  const assetPairs: (readonly [string, PluginAsset])[] = [];

  for (const plugin of plugins) {
    const digest = digestPlugin(plugin);
    const urls = new Map<string, string>();
    for (const file of plugin.files) {
      const url = pluginUrl(digest, file.relativePath);
      urls.set(file.relativePath, url);
      assetPairs.push([
        url,
        Object.freeze({
          body: new Blob([Uint8Array.from(file.bytes)]),
          contentType: contentTypeFor(file.relativePath),
        }),
      ]);
    }

    const clientEntryUrl = urls.get(plugin.manifest.clientEntry);
    if (!clientEntryUrl) throw new Error(`Validated plugin ${plugin.sourceId} has no client entry asset`);
    const staticAssetUrlPairs: (readonly [string, string])[] = [];
    for (const path of plugin.manifest.staticAssets ?? []) {
      const url = urls.get(path);
      if (!url) throw new Error(`Validated plugin ${plugin.sourceId} has no approved asset ${path}`);
      staticAssetUrlPairs.push([path, url]);
    }
    const staticAssetUrls = Object.fromEntries(staticAssetUrlPairs);
    entries.push(
      Object.freeze({
        sourceId: plugin.sourceId,
        manifest: plugin.manifest,
        clientEntryUrl,
        staticAssetUrls: Object.freeze(staticAssetUrls),
      }),
    );
  }

  const catalog = PluginBootstrapCatalogSchema.parse({
    schemaVersion: PLUGIN_BOOTSTRAP_SCHEMA_VERSION,
    entries,
    diagnostics,
  });
  const assets = Object.freeze(Object.fromEntries(assetPairs));
  return Object.freeze({ catalog: deepFreezeCatalog(catalog), assets });
}

const EMPTY_PLUGIN_RUNTIME_SNAPSHOT = createPluginRuntimeSnapshot([], []);

export function emptyPluginRuntimeSnapshot(): PluginRuntimeSnapshot {
  return EMPTY_PLUGIN_RUNTIME_SNAPSHOT;
}

export function servePluginAsset(pathname: string, snapshot: PluginRuntimeSnapshot): Response | null {
  const asset = snapshot.assets[pathname];
  if (!asset) return null;
  return new Response(asset.body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function digestPlugin(plugin: ValidatedPluginRoot): string {
  const hasher = new Bun.CryptoHasher("sha256");
  updateFrame(hasher, "manifest", plugin.manifestBytes);
  for (const file of plugin.files) {
    updateFrame(hasher, file.relativePath, file.bytes);
  }
  return hasher.digest("hex");
}

function updateFrame(hasher: Bun.CryptoHasher, label: string, bytes: Uint8Array): void {
  const labelBytes = new TextEncoder().encode(label);
  const lengths = new Uint8Array(8);
  const view = new DataView(lengths.buffer);
  view.setUint32(0, labelBytes.byteLength);
  view.setUint32(4, bytes.byteLength);
  hasher.update(lengths);
  hasher.update(labelBytes);
  hasher.update(bytes);
}

function pluginUrl(digest: string, relativePath: string): string {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/plugins/${digest}/${encoded}`;
}

function contentTypeFor(path: string): string {
  const byExtension: Record<string, string> = {
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return byExtension[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function deepFreezeCatalog(catalog: PluginBootstrapCatalog): PluginBootstrapCatalog {
  for (const entry of catalog.entries) {
    if (entry.manifest.hostCompatibility.platforms) Object.freeze(entry.manifest.hostCompatibility.platforms);
    Object.freeze(entry.manifest.hostCompatibility);
    entry.manifest.permissions.forEach(Object.freeze);
    Object.freeze(entry.manifest.permissions);
    if (entry.manifest.staticAssets) Object.freeze(entry.manifest.staticAssets);
    Object.freeze(entry.manifest);
    Object.freeze(entry.staticAssetUrls);
    Object.freeze(entry);
  }
  catalog.diagnostics.forEach(Object.freeze);
  Object.freeze(catalog.entries);
  Object.freeze(catalog.diagnostics);
  return Object.freeze(catalog);
}
