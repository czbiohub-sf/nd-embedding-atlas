/**
 * Shared annotation state: which annotation columns exist, and a revision that bumps on every
 * write so every node re-reads them.
 *
 * Three separate things conspire to make a label written in one node invisible in another, and
 * all three have to be handled together:
 *
 * 1. **Annotation columns are not obs columns.** A write goes to an `ann_{name}` table LEFT
 *    JOINed into the `dataset` view; `metadata.obs_columns` lists only what the store shipped
 *    with, and never learns about it. A node that gates on `obs_columns.includes("goodness_user")`
 *    therefore never SELECTs the column at all, and silently shows the imported label forever.
 *    `/api/annotations/columns` is the only authority, so this asks it.
 * 2. **No cross-node signal.** Each node's own `refetch()` after its own write tells nobody
 *    else. The revision here is that signal.
 * 3. **Mosaic caches by raw SQL text.** `QueryManager` keys results on the query string, so a
 *    refetch of byte-identical SQL returns the pre-write rows from cache. See
 *    {@link annotationCacheSuffix}.
 *
 * Module-level rather than a React context: one dataset session per page, and a node mounted
 * anywhere in the Stage tree must see the same revision as a node in another tile without the
 * two needing a common ancestor.
 */

import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Store } from "@tanstack/store";
import { useSelector } from "@tanstack/react-store";

const revisionStore = new Store(0);

/**
 * Announce that an annotation column was written or created.
 *
 * Call it AFTER the write resolves, not before: a reader that refetches while the write is
 * still in flight would cache the pre-write rows against the new revision and stay stale until
 * the next write.
 */
export function announceAnnotationWrite(): void {
  revisionStore.setState((revision) => revision + 1);
}

/** Current annotation revision. Changes whenever any node writes an annotation. */
export function useAnnotationRevision(): number {
  return useSelector(revisionStore, (revision) => revision);
}

/**
 * A SQL comment carrying the revision.
 *
 * `QueryManager` keys its cache on the raw SQL string, so this is what makes a re-read after a
 * write actually reach DuckDB. A trailing comment changes the cache key without changing the
 * parse, the plan, or the result — the alternative is bypassing the coordinator entirely and
 * losing connection pooling with it.
 */
export function annotationCacheSuffix(revision: number): string {
  return revision === 0 ? "" : `\n-- annotation-revision:${revision}`;
}

export interface AnnotationState {
  /** Names of existing annotation columns. Empty until the first fetch resolves. */
  columns: readonly string[];
  /** Bumps on every write; feed it to {@link annotationCacheSuffix}. */
  revision: number;
  /**
   * False until the column list is known. Consumers should hold their first data query until
   * this is true, or they will query without the annotation column, then re-key when it
   * arrives — and a key change drops `data` to undefined, which unmounts the view.
   */
  isReady: boolean;
  /**
   * Why the list could not be read.
   *
   * Surfaced rather than folded into an empty list, because those two states look identical to
   * a caller and mean opposite things: "no labels have been made yet" versus "labels exist and
   * you are about to ignore all of them".
   */
  error: string | null;
}

/**
 * The annotation columns that currently exist, refreshed on every write.
 *
 * Fetched directly rather than through `host.dataAPI.listAnnotationColumns`, which the app
 * attaches ONLY to nodes declaring `annotation-write`. That gate is wrong for a reader: any
 * `data-read` node can already `SELECT * FROM dataset` and see these columns AND their values,
 * so the name list carries strictly less than what it already has. Requiring write access to
 * learn a column's name, while its contents are freely readable, protects nothing and left
 * fov-score unable to see the labels it exists to score against.
 *
 * Shared through one react-query key, so N nodes calling this cause one request, and the
 * revision invalidates it for all of them at once.
 */
export function useAnnotationColumns(): AnnotationState {
  const revision = useAnnotationRevision();
  const query = useQuery({
    // STABLE key, with the revision driving a refetch below instead. The revision belongs in a
    // key even less here than in a data query: consumers derive `hasUser` from this list, so a
    // key change empties it for a tick, every consumer concludes the label column does not
    // exist, and their own queries re-key to a variant that does not SELECT it. The write then
    // makes the labels vanish instead of updating them.
    queryKey: ["annotation-columns"],
    queryFn: async () => {
      const response = await fetch("/api/annotations/columns");
      if (!response.ok) throw new Error(`annotation columns: ${response.status} ${response.statusText}`);
      const body = (await response.json()) as { columns?: { name: string }[] };
      return (body.columns ?? []).map((column) => column.name);
    },
    // Refreshed by the revision, never by the clock: columns cannot appear on their own.
    staleTime: Number.POSITIVE_INFINITY,
  });

  const refetch = useCallback(() => void query.refetch(), [query]);
  // A write may have CREATED a column, so the list itself has to follow writes.
  useRefetchOnAnnotationWrite(revision, refetch);

  return {
    columns: query.data ?? [],
    revision,
    isReady: query.isSuccess || query.isError,
    error: query.error ? String(query.error) : null,
  };
}

/**
 * Re-read in place when an annotation is written elsewhere.
 *
 * Deliberately a `refetch` rather than a revision in the query key. Putting the revision in the
 * key makes react-query treat every write as a brand-new query, so `data` drops to undefined
 * and the whole view unmounts and remounts — the "editing one FOV makes the node flash"
 * failure. `refetch` keeps the previous rows on screen until the new ones land.
 */
export function useRefetchOnAnnotationWrite(revision: number, refetch: () => void): void {
  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current === revision) return;
    seen.current = revision;
    refetch();
  }, [revision, refetch]);
}
