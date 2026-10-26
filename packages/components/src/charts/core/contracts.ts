import type { FilterCoordinationAPI } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import type { FilterExpr, Query } from "@uwdata/mosaic-sql";

export interface ChartQueryOptions<T> {
  coordinator: Coordinator;
  filter: Pick<FilterCoordinationAPI, "selection">;
  query: (predicate: FilterExpr) => ReturnType<typeof Query.from> | string | null;
  transform: (result: unknown) => T;
  enabled?: boolean;
}

export interface ChartQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export type UseChartQuery = <T>(options: ChartQueryOptions<T>) => ChartQueryResult<T>;

/** App-provided query/session hooks used by React chart bodies. */
export interface ChartServices {
  useQuery: UseChartQuery;
}
