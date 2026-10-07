/**
 * A node's membership in a crossfilter `filter` scope. Published clauses land
 * in the workspace document at `/state/filter/<scope>/<nodeId>/<facet>`; the
 * node's Mosaic `selection` carries its graph input plus every other source's
 * clauses (`filterScopeSql`), so the server and the browser compose alike.
 */

import type { FilterClause } from "@ndea/protocol";
import type { FilterCoordinationAPI, FilterFacet, MaterializedFilterRows, ResolvedFilter, RowIndex } from "@ndea/sdk";
import { Selection } from "@uwdata/mosaic-core";

import { stringPredicate, toRows } from "@/lib/mosaic-helpers";
import type { CoordinationScopeCellPort } from "./coordination";
import { filterClausesSql, filterScopeClauses } from "./types";

export interface FilterBinding extends FilterCoordinationAPI {
  setGraphPredicate(sql: string | null): void;
  dispose(): void;
}

interface FilterBindingOptions {
  readonly nodeId: string;
  readonly coordination: CoordinationScopeCellPort;
  readonly coordinator: { query(sql: string): Promise<unknown> };
  readonly table: string;
}

function abortError(): DOMException {
  return new DOMException("filter materialization aborted", "AbortError");
}

export function createFilterBinding({ nodeId, coordination, coordinator, table }: FilterBindingOptions): FilterBinding {
  const selection = Selection.intersect();
  const source = { __ndeaFilterBinding: nodeId };
  const listeners = new Set<(filter: ResolvedFilter) => void>();
  let graphPredicate: string | null = null;
  let resolved: string | null = null;
  let revision = 0;
  let disposed = false;

  const scopeSql = () => {
    const scope = coordination.scopeOf(nodeId, "filter");
    if (scope === undefined) return null;
    return filterClausesSql(filterScopeClauses(coordination.readCoordination("filter", scope), nodeId));
  };

  const refresh = (force = false) => {
    const parts = [graphPredicate, scopeSql()].filter((sql): sql is string => sql !== null);
    const next =
      parts.length === 0 ? null : parts.length === 1 ? parts[0] : parts.map((sql) => `(${sql})`).join(" AND ");
    if (!force && next === resolved) return;
    resolved = next;
    revision += 1;
    selection.update({
      source,
      clients: new Set(),
      fields: [],
      value: next,
      predicate: next === null ? null : stringPredicate(next),
    });
    const filter = { predicate: resolved, revision };
    for (const listener of listeners) listener(filter);
  };

  const unsubscribe = [
    coordination.subscribe(nodeId, "filter", () => refresh()),
    coordination.subscribeScope(nodeId, "filter", () => refresh()),
  ];

  const assertLive = () => {
    if (disposed) throw new Error(`filter binding ${nodeId} is disposed`);
  };

  const writeFacet = (facet: FilterFacet, clause: FilterClause | null) => {
    assertLive();
    const scope = coordination.scopeOf(nodeId, "filter");
    if (scope === undefined) return;
    const cell = coordination.readCoordination("filter", scope) ?? {};
    const { [facet]: _previous, ...facets } = cell[nodeId] ?? {};
    if (clause === null && _previous === undefined) return;
    const { [nodeId]: _own, ...others } = cell;
    const own = clause === null ? facets : { ...facets, [facet]: clause };
    coordination.setCoordinationValue(
      "filter",
      scope,
      Object.keys(own).length > 0 ? { ...others, [nodeId]: own } : others,
    );
  };

  refresh(true);

  return {
    selection,
    getResolved: () => ({ predicate: resolved, revision }),
    subscribeResolved(callback) {
      assertLive();
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    publish: (facet, clause) => writeFacet(facet, clause),
    clear: (facet) => writeFacet(facet, null),
    async materializeRowIds(signal?: AbortSignal): Promise<MaterializedFilterRows> {
      assertLive();
      if (signal?.aborted) throw abortError();
      const at = revision;
      const result = await coordinator.query(
        `SELECT __row_index__ FROM ${table}${resolved === null ? "" : ` WHERE ${resolved}`}`,
      );
      if (signal?.aborted) throw abortError();
      if (disposed || revision !== at) throw new Error("filter changed during row-id materialization");
      return { rowIds: toRows(result).map((row) => Number(row.__row_index__) as RowIndex), revision: at };
    },
    setGraphPredicate(sql) {
      assertLive();
      graphPredicate = sql;
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of unsubscribe) off();
      listeners.clear();
      selection.update({ source, clients: new Set(), fields: [], value: null, predicate: null });
    },
  };
}
