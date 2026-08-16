import type { NodeBodyProps as SharedNodeBodyProps } from "../contracts";

export type NodeBodyProps<Config, Capabilities extends TableCapabilities> = SharedNodeBodyProps<Config, Capabilities>;

export interface TableConfig {
  /** Reserved for per-instance column selection. */
  columns: string[] | null;
}

export type TableOptions = Record<string, never>;
export type TableCapabilities = "data-read" | "filter-coordination" | "ordering-coordination" | "focus-coordination";

export interface TableServices {
  bodyHeaderElement(host: unknown): HTMLElement;
}
