import type { ComponentType, MouseEvent } from "react";
import type { NodeHost } from "@ndea/sdk";

export type CacheCapabilities = "filter-coordination";

export type CacheCheckpointInput =
  | {
      readonly kind: "predicate";
      readonly predicate: string | null;
    }
  | {
      readonly kind: "row-set";
      readonly predicate: string | null;
      readonly rowCount: number | null;
    };

export interface CacheCheckpointSnapshot {
  readonly epoch: number;
  readonly pinned: boolean;
  readonly pinnedEpoch: number | null;
  readonly input: CacheCheckpointInput | null;
  readonly pending: boolean;
  readonly error: string | null;
}

export interface CacheCheckpointService {
  getSnapshot(): CacheCheckpointSnapshot;
  subscribe(onChange: () => void): () => void;
  pin(): Promise<boolean>;
  unpin(): void;
}

export type CacheCheckpointResolver = (host: NodeHost<unknown, CacheCapabilities>) => CacheCheckpointService;

export type CacheIconButton = ComponentType<{
  icon: "freeze";
  label: string;
  title: string;
  tone?: "amber";
  className?: string;
  onClick?: (event: MouseEvent) => void;
}>;
