import type { NodeDefinition, PluginDisposer, PluginFactory, PluginManifest } from "@ndea/sdk";

/** Type-erased only at the heterogeneous catalog boundary; definitions retain their precise author type before registration. */
// oxlint-disable-next-line no-explicit-any -- TypeScript has no existential generics; catalog validation checks every erased definition before indexing.
export type CatalogNodeDefinition = NodeDefinition<any, any>;

export interface NativeContributionSource {
  readonly kind: "native";
  readonly sourceId: string;
}

export interface ExternalContributionSource {
  readonly kind: "plugin";
  readonly manifest: PluginManifest;
}

export type NodeContributionSource = NativeContributionSource | ExternalContributionSource;

export interface PluginContributionBatch {
  readonly source: NodeContributionSource;
  readonly definitions: readonly CatalogNodeDefinition[];
  readonly dispose?: PluginDisposer;
}

export const NATIVE_NODE_SOURCE: NativeContributionSource = Object.freeze({
  kind: "native",
  sourceId: "ndea/native",
});

/** Collects one factory in isolation. The returned batch has not touched a catalog. */
export async function collectPluginContribution(
  source: NodeContributionSource,
  factory: PluginFactory,
): Promise<PluginContributionBatch> {
  const definitions: CatalogNodeDefinition[] = [];
  let accepting = true;

  const dispose = await factory({
    registerNode(definition) {
      if (!accepting) throw new Error(`plugin factory "${formatContributionSource(source)}" registered after setup`);
      definitions.push(definition as CatalogNodeDefinition);
    },
  });
  accepting = false;
  if (dispose !== undefined && typeof dispose !== "function") {
    throw new Error(`plugin factory "${formatContributionSource(source)}" returned an invalid disposer`);
  }

  return Object.freeze({
    source: freezeContributionSource(source),
    definitions: Object.freeze([...definitions]),
    ...(dispose ? { dispose } : {}),
  });
}

/** Runs successful setup disposers in reverse registration order. */
export function disposePluginContributions(batches: readonly PluginContributionBatch[]): void {
  const errors: unknown[] = [];
  for (let index = batches.length - 1; index >= 0; index -= 1) {
    try {
      batches[index]?.dispose?.();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "plugin contribution disposal failed");
}

export function formatContributionSource(source: NodeContributionSource): string {
  return source.kind === "native"
    ? source.sourceId
    : `${source.manifest.pluginId}@${source.manifest.pluginPackageVersion}`;
}

export function freezeContributionSource(source: NodeContributionSource): NodeContributionSource {
  if (source.kind === "native") return Object.freeze({ ...source });
  const manifest = source.manifest;
  const hostCompatibility = {
    ...manifest.hostCompatibility,
    ...(manifest.hostCompatibility.platforms ? { platforms: [...manifest.hostCompatibility.platforms] } : {}),
  };
  if (hostCompatibility.platforms) Object.freeze(hostCompatibility.platforms);
  Object.freeze(hostCompatibility);
  const permissions = manifest.permissions.map((permission) => Object.freeze({ ...permission }));
  Object.freeze(permissions);
  const staticAssets = manifest.staticAssets ? [...manifest.staticAssets] : undefined;
  if (staticAssets) Object.freeze(staticAssets);
  const frozenManifest = {
    ...manifest,
    hostCompatibility,
    permissions,
    ...(staticAssets ? { staticAssets } : {}),
  };
  Object.freeze(frozenManifest);
  return Object.freeze({
    kind: "plugin",
    manifest: frozenManifest,
  });
}
