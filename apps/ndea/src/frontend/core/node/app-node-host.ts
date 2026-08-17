import type { NodeCapability, NodeHost } from "@ndea/sdk";

export type CheckpointInputState =
  | {
      readonly kind: "predicate";
      readonly predicate: string | null;
    }
  | {
      readonly kind: "row-set";
      readonly predicate: string | null;
      readonly rowCount: number | null;
    };

export interface CheckpointState {
  readonly epoch: number;
  readonly pinned: boolean;
  readonly pinnedEpoch: number | null;
  readonly input: CheckpointInputState | null;
  readonly pending: boolean;
  readonly error: string | null;
}

export interface CheckpointNodeHost {
  readonly checkpoint: {
    getSnapshot(): CheckpointState;
    subscribe(onChange: () => void): () => void;
    pin(): Promise<boolean>;
    unpin(): void;
  };
}

export interface CheckpointCreationNodeHost {
  readonly checkpointCreation: {
    create(): string | null;
  };
}

export interface HierarchyState {
  readonly childCount: number;
}

export interface HierarchyNodeHost {
  readonly hierarchy: {
    getSnapshot(): HierarchyState;
    subscribe(onChange: () => void): () => void;
    enter(): void;
  };
}

export interface AppNodeHostFacetMap {
  readonly checkpoint: CheckpointNodeHost["checkpoint"];
  readonly checkpointCreation: CheckpointCreationNodeHost["checkpointCreation"];
  readonly hierarchy: HierarchyNodeHost["hierarchy"];
  readonly bodyHeaderElement: HTMLElement;
}

export type AppNodeHostFacetName = keyof AppNodeHostFacetMap;

function requireMethods(value: unknown, facet: AppNodeHostFacetName, methods: readonly string[]): object {
  if (value === null || typeof value !== "object") throw new Error(`app node host requires facet "${facet}"`);
  for (const method of methods) {
    if (typeof Reflect.get(value, method) !== "function") {
      throw new TypeError(`app node host facet "${facet}.${method}" must be callable`);
    }
  }
  return value;
}

/** Resolve one closed app-only facet and prove its runtime structure. */
export function requireAppNodeHostFacet<Facet extends AppNodeHostFacetName>(
  host: unknown,
  facet: Facet,
): AppNodeHostFacetMap[Facet] {
  if (host === null || typeof host !== "object") throw new Error(`app node host requires facet "${facet}"`);
  const value = Reflect.get(host, facet);
  switch (facet) {
    case "checkpoint":
      return requireMethods(value, facet, ["getSnapshot", "subscribe", "pin", "unpin"]) as AppNodeHostFacetMap[Facet];
    case "checkpointCreation":
      return requireMethods(value, facet, ["create"]) as AppNodeHostFacetMap[Facet];
    case "hierarchy":
      return requireMethods(value, facet, ["getSnapshot", "subscribe", "enter"]) as AppNodeHostFacetMap[Facet];
    case "bodyHeaderElement":
      if (value === null || typeof value !== "object" || typeof Reflect.get(value, "appendChild") !== "function") {
        throw new Error('app node host requires facet "bodyHeaderElement"');
      }
      return value;
  }
  throw new Error(`unknown app node host facet "${facet}"`);
}

export function assertRequiredAppNodeHostFacets(host: unknown, required: readonly AppNodeHostFacetName[]): void {
  for (const facet of required) requireAppNodeHostFacet(host, facet);
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
