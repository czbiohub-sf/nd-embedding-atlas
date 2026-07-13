/**
 * Branded nominal types for cross-cutting identifiers.
 * Shared by providers/, scatter-gpu/, and components/.
 */

export { rowIndex, type RowIndex } from "@ndea/sdk";

/** Stable panel identifier — branded string to prevent accidental mixing. */
export type PanelId = string & { readonly __brand: "PanelId" };
export const panelId = (id: string): PanelId => id as PanelId;

/** Position in a packed GPU point buffer, not a dataset row identity. */
export type GpuPointIndex = number & { readonly __brand: "GpuPointIndex" };
export const gpuPointIndex = (value: number): GpuPointIndex => value as GpuPointIndex;

/** Durable value from the dataset's `obs_name` field. */
export type ObservationName = string & { readonly __brand: "ObservationName" };
export const observationName = (value: string): ObservationName => value as ObservationName;

/** Stable hash of viewer channel state for React Query cache keys. */
export type ChannelHash = string & { readonly __brand: "ChannelHash" };
export const channelHash = (s: string): ChannelHash => s as ChannelHash;

/** Collection identifier — branded to prevent accidental mixing with other string IDs. */
export type CollectionId = string & { readonly __brand: "CollectionId" };
export const collectionId = (s: string): CollectionId => s as CollectionId;
