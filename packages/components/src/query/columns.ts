import { type CatalogColumn, ColumnCatalogSchema } from "@ndea/protocol";
import { useQuery } from "@tanstack/react-query";

/** Column name → catalog entry, in VIEW order. */
export type Columns = ReadonlyMap<string, CatalogColumn>;

/** The catalog's query key: a field operation invalidates it so every view refetches. */
export const columnsQueryKey = ["columns"] as const;

/** The `dataset` VIEW's columns from `GET /api/columns` (internal `__*` columns excluded). */
export async function fetchColumns(signal?: AbortSignal): Promise<Columns> {
  const response = await fetch("/api/columns", { signal });
  if (!response.ok) throw new Error(`Loading columns failed (${response.status})`);
  return new Map(ColumnCatalogSchema.parse(await response.json()).map((column) => [column.name, column]));
}

/** The column catalog; null while loading. */
export function useColumns(): Columns | null {
  return (
    useQuery({ queryKey: columnsQueryKey, queryFn: ({ signal }) => fetchColumns(signal), staleTime: Infinity }).data ??
    null
  );
}
