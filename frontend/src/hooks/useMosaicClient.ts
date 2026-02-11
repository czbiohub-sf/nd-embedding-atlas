import { type Coordinator, makeClient, type Selection } from "@uwdata/mosaic-core";
import type { FilterExpr, Query } from "@uwdata/mosaic-sql";
import { useEffect, useRef, useState } from "react";

export interface UseMosaicClientOptions<T> {
    coordinator: Coordinator;
    selection?: Selection;
    /** Must be memoized (useCallback). Returns a SQL query for the given filter predicate. */
    query: (predicate: FilterExpr) => ReturnType<typeof Query.from> | string | null;
    /** Must be memoized (useCallback). Transforms raw query result into typed data. */
    transform: (result: unknown) => T;
    /** Set false to disable the client. Default true. */
    enabled?: boolean;
}

interface UseMosaicClientResult<T> {
    data: T | null;
    loading: boolean;
    error: Error | null;
}

export function useMosaicClient<T>(opts: UseMosaicClientOptions<T>): UseMosaicClientResult<T> {
    const { coordinator, selection, query, transform, enabled = true } = opts;

    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Keep transform in a ref so queryResult always uses latest without
    // triggering client re-creation.
    const transformRef = useRef(transform);
    transformRef.current = transform;

    // Create the mosaic client — recreate only when coordinator, selection,
    // query function, or enabled flag changes.
    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        const client = makeClient({
            coordinator,
            selection,
            filterStable: true,
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
            },
        });

        return () => {
            client.destroy();
        };
    }, [coordinator, selection, query, enabled]);

    return { data, loading, error };
}
