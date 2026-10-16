export interface TableConfig {
  /** Reserved for per-instance column selection. */
  columns: string[] | null;
}

export type TableOptions = Record<string, never>;
