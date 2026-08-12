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

/** Product-only facets layered onto the framework-neutral SDK host. */
export type AppNodeHost<Config, Capabilities extends NodeCapability, Facets extends object = object> = NodeHost<
  Config,
  Capabilities
> &
  Facets & {
    readonly bodyHeaderElement?: HTMLElement;
  };

export interface NodeBodyProps<Config, Capabilities extends NodeCapability, Facets extends object = object> {
  readonly host: AppNodeHost<Config, Capabilities, Facets>;
}
