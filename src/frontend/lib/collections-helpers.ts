/**
 * Collection helpers — pure functions over the Collection wire shape.
 *
 * Lives in lib/ (not protocol/) because these are *consumers* of the wire
 * shape, not the wire itself. Promote to a shared `src/lib/` if the
 * server ever needs the same predicates.
 */

import type { Collection } from "../../protocol/index.ts";

/**
 * Detect the "synthetic obs_name" provenance flag stamped server-side
 * when the dataset has no explicit string obs_name column. Used by the
 * row badge + HoverCard caveat — synthetic-id collections drift on
 * re-ingest and can't be relied on past one session.
 */
export function hasSyntheticIdentity(provenance: unknown): boolean {
  return (
    provenance != null &&
    typeof provenance === "object" &&
    "synthetic_identity" in provenance &&
    (provenance as { synthetic_identity: unknown }).synthetic_identity === true
  );
}

/**
 * True iff the collection's stored member count exceeds what currently
 * resolves in obs_base — surfaces a "drift" badge on the row.
 */
export function hasDrift(c: Pick<Collection, "current_count" | "created_count">): boolean {
  return c.current_count < c.created_count;
}

/**
 * Strip diacritics + lower-case for case- AND diacritic-insensitive matching.
 *
 * NFKD decomposes accented characters into base + combining mark; the
 * regex strips combining marks. Output is suitable as the haystack/needle
 * for indexOf-based substring search.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase();
}

/**
 * Filter a collections list by case- + diacritic-insensitive substring
 * match against name AND joined tags. Notes are NOT searched in v1.
 *
 * Empty query returns the input unchanged (no allocation).
 */
export function filterCollections(collections: readonly Collection[], query: string): readonly Collection[] {
  const q = normalizeForSearch(query.trim());
  if (q.length === 0) return collections;
  return collections.filter((c) => {
    const haystack = normalizeForSearch(`${c.name} ${c.tags.join(" ")}`);
    return haystack.includes(q);
  });
}
