/**
 * Zarrita boundary adapters.
 *
 * Our public types and zarrita's internal types don't quite line up — zarrita
 * returns `Group<Readable>` with a private `.store` field; our own stores
 * implement the `AsyncReadable` shape but not the full `Readable` interface.
 * These helpers funnel every `as unknown as X` cast into one named spot so
 * the intent is explicit and future zarrita type changes break in one file.
 */

import type { AsyncReadable, Readable } from "zarrita";

/**
 * Wrap our own store (`BunFileStore`, `FetchStore` mock, etc.) as the
 * `Readable` type zarrita's `zarr.open()` expects. Safe because we only
 * implement the `.get(key)` method zarrita actually calls.
 */
export function asReadable(store: AsyncReadable): Readable {
  return store as unknown as Readable;
}

/**
 * Extract the private `.store` field from a zarrita Location / Group.
 * Used by `withConsolidatedMetadata` + filesystem listing paths that
 * need to reach under zarrita's public API.
 */
export function extractStore(group: unknown): AsyncReadable | undefined {
  return (group as { store?: AsyncReadable }).store;
}

/**
 * Extract the filesystem root from a zarrita store (BunFileStore or
 * FileSystemStore). Returns undefined for non-filesystem stores.
 */
export function extractStoreRoot(group: unknown): string | undefined {
  const store = extractStore(group);
  return (store as { root?: string } | undefined)?.root;
}
