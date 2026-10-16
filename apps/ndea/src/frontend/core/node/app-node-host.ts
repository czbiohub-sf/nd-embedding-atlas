import type { NodeCapability, NodeHost } from "@ndea/sdk";

/** The body's header toolbar slot: the one product-only host facet. */
export function requireAppNodeHostFacet(host: unknown, facet: "bodyHeaderElement"): HTMLElement {
  const value = host !== null && typeof host === "object" ? Reflect.get(host, facet) : undefined;
  if (value === null || typeof value !== "object" || typeof Reflect.get(value, "appendChild") !== "function") {
    throw new Error(`app node host requires facet "${facet}"`);
  }
  return value as HTMLElement;
}

/** Product-only facets layered onto the framework-neutral SDK host. */
export type AppNodeHost<Config, Capabilities extends NodeCapability, Facets extends object = object> = NodeHost<
  Config,
  Capabilities
> &
  Facets & {
    readonly bodyHeaderElement?: HTMLElement;
  };

/** Core-only host shape used until runtime capability services are validated. */
export type ErasedAppNodeHost<Config = unknown> = Omit<NodeHost<Config>, "capabilities"> & {
  readonly capabilities: ReadonlySet<NodeCapability>;
  readonly bodyHeaderElement?: HTMLElement;
};
