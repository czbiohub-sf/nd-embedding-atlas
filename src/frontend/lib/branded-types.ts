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

/** Stable hash of viewer channel state for React Query cache keys. */
export type ChannelHash = string & { readonly __brand: "ChannelHash" };
export const channelHash = (s: string): ChannelHash => s as ChannelHash;

/** ObsSet identifier — branded to prevent accidental mixing with other string IDs. */
export type ObsSetId = string & { readonly __brand: "ObsSetId" };
export const obsSetId = (s: string): ObsSetId => s as ObsSetId;
