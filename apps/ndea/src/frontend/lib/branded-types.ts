/**
 * Branded nominal types for cross-cutting identifiers.
 * Shared by providers/, scatter-gpu/, and components/.
 */

export { rowIndex, type RowIndex } from "@ndea/sdk";

/** Position in a packed GPU point buffer, not a dataset row identity. */
export type GpuPointIndex = number & { readonly __brand: "GpuPointIndex" };
export const gpuPointIndex = (value: number): GpuPointIndex => value as GpuPointIndex;

/** Durable value from the dataset's `obs_name` field. */
export type ObservationName = string & { readonly __brand: "ObservationName" };
export const observationName = (value: string): ObservationName => value as ObservationName;
