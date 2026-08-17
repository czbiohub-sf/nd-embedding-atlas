import { type Coordinator, makeClient, type Selection } from "@uwdata/mosaic-core";
import type { FilterExpr, Query } from "@uwdata/mosaic-sql";
import { useEffect, useRef, useState } from "react";
import type { FilterCoordinationAPI } from "@ndea/sdk";

export interface UseMosaicClientOptions<T> {
  coordinator: Coordinator;
  selection?: Selection;
  filter?: Pick<FilterCoordinationAPI, "selection" | "associateClient" | "disassociateClient">;
  /** Whether filtering preserves the query's group-by domain. Default true. */
  filterStable?: boolean;
  /** Must be memoized (useCallback). Returns a SQL query for the given filter predicate. */
  query: (predicate: FilterExpr) => ReturnType<typeof Query.from> | string | null;
  /** Must be memoized (useCallback). Transforms raw query result into typed data. */
  transform: (result: unknown) => T;
  /** Set false to disable the client. Default true. */
  enabled?: boolean;
  /** Called when the query errors. */
  onError?: (err: Error) => void;
}

interface UseMosaicClientResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useMosaicClient<T>(opts: UseMosaicClientOptions<T>): UseMosaicClientResult<T> {
  const { coordinator, selection, filter, filterStable = true, query, transform, enabled = true, onError } = opts;
  const filterSelection = filter?.selection ?? selection;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Keep transform in a ref so queryResult always uses latest without
  // triggering client re-creation.
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Create the mosaic client: recreate only when coordinator, selection,
  // query function, or enabled flag changes.
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return () => {};
    }

    setLoading(true);
    setError(null);

    const client = makeClient({
      coordinator,
      selection: filterSelection,
      filterStable,
      query,
      queryPending: () => {
        setLoading(true);
      },
      queryResult: (result: unknown) => {
        try {
          setData(transformRef.current(result));
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
        setLoading(false);
      },
      queryError: (err: Error) => {
        setError(err);
        setLoading(false);
        onErrorRef.current?.(err);
      },
    });
    const clientFilter = filter;
    clientFilter?.associateClient(client);
    let released = false;

    return () => {
      if (released) return;
      released = true;
      clientFilter?.disassociateClient(client);
      client.destroy();
    };
  }, [coordinator, filterSelection, filter, filterStable, query, enabled]);

  return { data, loading, error };
}
