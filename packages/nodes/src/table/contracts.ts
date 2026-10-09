import type { Metadata } from "@ndea/protocol";
import type { GalleryChannels } from "../gallery/useGalleryChannels";
import type { NodeBodyProps as SharedNodeBodyProps } from "../contracts";

export type NodeBodyProps<Config, Capabilities extends TableCapabilities> = SharedNodeBodyProps<Config, Capabilities>;

export interface TableConfig {
  /** Reserved for per-instance column selection. */
  columns: string[] | null;
  /**
   * Column to group rows by, or null for a flat table. Persisted so a grouped
   * table survives reload; the grouping itself runs as a DuckDB `GROUP BY`.
   */
  groupBy?: string | null;
}

export type TableOptions = Record<string, never>;
export type TableCapabilities = "data-read" | "filter-coordination" | "ordering-coordination" | "focus-coordination";

export interface TableServices {
  bodyHeaderElement(host: unknown): HTMLElement;
  readonly viewerZ: (instanceId: string) => number;
  readonly channels: (instanceId: string, wait: number, plateChannels?: Metadata["plate_channels"]) => GalleryChannels;
}
