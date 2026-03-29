/**
 * Branded nominal types for cross-cutting identifiers.
 * Shared by providers/, scatter-gpu/, and components/.
 */

/** Stable panel identifier — branded string to prevent accidental mixing. */
export type PanelId = string & { readonly __brand: "PanelId" };
export const panelId = (id: string): PanelId => id as PanelId;

/** DuckDB __row_index__ value — distinct from GPU buffer point indices. */
export type RowIndex = number & { readonly __brand: "RowIndex" };
export const rowIndex = (n: number): RowIndex => n as RowIndex;
