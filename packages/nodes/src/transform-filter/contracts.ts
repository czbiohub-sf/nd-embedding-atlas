import type { DataContext } from "@ndea/sdk";

export type { NodeBodyProps } from "../contracts";

export interface ThresholdFilterConfig {
  /** Numeric obs column to threshold on; null until the schema resolves. */
  column: string | null;
  threshold: number;
}

export type ThresholdFilterOptions = Record<never, never>;
export type TransformFilterCapabilities = "data-read" | "compute";
export type TransformFilterColumnType = "string" | "number" | "boolean" | "other";
export type TransformFilterColumnTypes = ReadonlyMap<string, TransformFilterColumnType>;

/** App-provided schema lookup; kept narrow so the definition stays portable. */
export type TransformFilterColumnTypesService = (
  coordinator: DataContext["coordinator"],
) => TransformFilterColumnTypes | null;
