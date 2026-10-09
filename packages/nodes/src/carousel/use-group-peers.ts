/**
 * Group expansion: the "group by" a comparison carousel needs, without aggregating.
 *
 * A comparison sweep is not a GROUP BY in the aggregate sense — nothing is folded.
 * It is a PEER EXPANSION: given one focused obs, return every obs sharing its
 * `groupBy` value, ordered along a `variantBy` axis. One reconstruction of one FOV
 * at 25 regularizer strengths is 25 sibling obs rows, and the carousel slides
 * across them.
 *
 * That distinction is why this does not live in the Wrangle node. Every graph edge
 * carries a WHERE predicate, so a node emitting grouped or aggregated relations
 * would need a new port kind and a new cook contract. Peer expansion needs neither:
 * it is a scalar subquery over the same `dataset` VIEW.
 *
 * Two queries, two jobs:
 *  - {@link useGroupPeers} — the full variant sweep for the focused group. It
 *    deliberately IGNORES the upstream scope: the point of a sweep is to see every
 *    regularizer for this FOV even when the scope filtered most of them out.
 *    Hiding variants would silently bias the comparison.
 *  - {@link useGroupCursor} — the distinct group keys that ARE in scope, so the
 *    user can step group to group. Scope picks WHICH FOVs you annotate; the sweep
 *    shows every variant of the one you are on.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { rowIndex, type RowIndex } from "@ndea/sdk";
import type { Coordinator } from "@uwdata/mosaic-core";
import { toRows } from "../query/mosaic";

/** Upper bound on groups offered to the cursor, to bound the result set. */
const MAX_GROUPS = 5000;

/** Double-quote a SQL identifier, doubling any embedded quote. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A scalar group key as a SQL literal, escaping quotes in the string case. */
function literalOf(value: GroupValue): string {
  return typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`;
}

/** A scalar group key. DuckDB returns numerics as numbers over the JSON path. */
export type GroupValue = string | number;

/** Spatial obs columns this dataset actually has, resolved from metadata. */
export interface GroupPeerFields {
  fov: string | null;
  t: string | null;
  x: string | null;
  y: string | null;
  dataset: string | null;
}

/** One slide: a sibling obs at one point on the variant axis. */
export interface GroupPeer {
  rowIndex: RowIndex;
  /** Value of the variant column, e.g. `reg_power = -2.33`. */
  variant: GroupValue | null;
  fovName: string | null;
  datasetKey: string | undefined;
  t: number;
  x: number;
  y: number;
  /** Committed label for this obs, before any optimistic overlay. */
  label: string | null;
}

/** Resolve which group an obs belongs to. Keyed on the row, and only the row. */
export function useRowGroup({
  coordinator,
  groupBy,
  rowIndex: row,
}: {
  coordinator: Coordinator;
  groupBy: string | null;
  rowIndex: RowIndex | null;
}): { groupValue: GroupValue | null; loading: boolean } {
  const enabled = groupBy != null && row != null;
  const query = useQuery<GroupValue | null>({
    queryKey: ["carousel-row-group", groupBy, row],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      if (groupBy == null || row == null) return null;
      const sql = `SELECT ${ident(groupBy)} AS group_value FROM dataset WHERE ${ident("__row_index__")} = ${row} LIMIT 1`;
      const rows = toRows<GroupRow>(await coordinator.query(sql, { type: "json" }));
      return rows[0]?.group_value ?? null;
    },
  });
  return { groupValue: query.data ?? null, loading: enabled && query.isPending };
}

export interface UseGroupPeersOptions {
  coordinator: Coordinator;
  /** Column whose shared value defines one group, e.g. `row_idx`. */
  groupBy: string | null;
  /** Column that varies within a group, e.g. `reg_power`. */
  variantBy: string | null;
  /**
   * The group to expand.
   *
   * Deliberately the GROUP KEY and not the focused row: every member of a group
   * expands to the identical peer list, so keying on the row made clicking a
   * sibling change the cache key, drop the result, unmount the carousel, and
   * re-init the track at index 0 before animating back. Keyed on the group, a
   * sibling click is a pure selection change and the strip never reloads.
   */
  groupValue: GroupValue | null;
  /** Annotation column to read committed labels from, when configured. */
  labelColumn: string | null;
  fields: GroupPeerFields;
}

export interface UseGroupPeersResult {
  peers: GroupPeer[];
  loading: boolean;
  error: Error | null;
}

interface PeerRow {
  row_index: number;
  variant: GroupValue | null;
  fov_name: string | null;
  dataset_key: string | null;
  t: number | null;
  x: number | null;
  y: number | null;
  label: string | null;
}

export function useGroupPeers({
  coordinator,
  groupBy,
  variantBy,
  groupValue,
  labelColumn,
  fields,
}: UseGroupPeersOptions): UseGroupPeersResult {
  const enabled = groupBy != null && variantBy != null && groupValue != null;

  const query = useQuery<GroupPeer[]>({
    queryKey: ["carousel-group-peers", groupBy, variantBy, groupValue, labelColumn, fields],
    enabled,
    staleTime: Infinity,
    // Hold the previous group's slides while the next one loads: blanking the
    // list is what tears the track down and restarts it.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (groupBy == null || variantBy == null || groupValue == null) return [];

      const selects = [
        `d.${ident("__row_index__")} AS row_index`,
        `d.${ident(variantBy)} AS variant`,
        fields.fov ? `d.${ident(fields.fov)} AS fov_name` : "NULL AS fov_name",
        fields.dataset ? `d.${ident(fields.dataset)} AS dataset_key` : "NULL AS dataset_key",
        fields.t ? `d.${ident(fields.t)} AS t` : "0 AS t",
        fields.x ? `d.${ident(fields.x)} AS x` : "0 AS x",
        fields.y ? `d.${ident(fields.y)} AS y` : "0 AS y",
        labelColumn ? `CAST(d.${ident(labelColumn)} AS TEXT) AS label` : "NULL AS label",
      ];

      const sql =
        `SELECT ${selects.join(", ")} FROM dataset d ` +
        `WHERE d.${ident(groupBy)} = ${literalOf(groupValue)} ` +
        `ORDER BY d.${ident(variantBy)} ASC`;

      const rows = toRows<PeerRow>(await coordinator.query(sql, { type: "json" }));
      return rows.map<GroupPeer>((r) => ({
        rowIndex: rowIndex(r.row_index),
        variant: r.variant,
        fovName: r.fov_name,
        datasetKey: r.dataset_key ?? undefined,
        t: r.t ?? 0,
        x: r.x ?? 0,
        y: r.y ?? 0,
        label: r.label,
      }));
    },
  });

  return {
    peers: query.data ?? [],
    loading: enabled && query.isPending,
    error: query.error,
  };
}

export interface UseGroupCursorOptions {
  coordinator: Coordinator;
  groupBy: string | null;
  /** Upstream scope predicate; null when the node is unwired. */
  predicate: string | null;
}

export interface UseGroupCursorResult {
  /** Distinct group keys in scope, ordered. */
  groups: GroupValue[];
  loading: boolean;
  error: Error | null;
}

interface GroupRow {
  group_value: GroupValue | null;
}

/**
 * The groups the upstream scope admits, so the carousel can step from one FOV to
 * the next without leaving the node.
 */
export function useGroupCursor({ coordinator, groupBy, predicate }: UseGroupCursorOptions): UseGroupCursorResult {
  const enabled = groupBy != null;

  const query = useQuery<GroupValue[]>({
    queryKey: ["carousel-group-cursor", groupBy, predicate],
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () => {
      if (groupBy == null) return [];
      const where = predicate ? ` WHERE ${predicate}` : "";
      const sql =
        `SELECT DISTINCT ${ident(groupBy)} AS group_value FROM dataset${where} ` +
        `ORDER BY group_value ASC LIMIT ${MAX_GROUPS}`;
      const rows = toRows<GroupRow>(await coordinator.query(sql, { type: "json" }));
      return rows.map((r) => r.group_value).filter((v): v is GroupValue => v != null);
    },
  });

  return { groups: query.data ?? [], loading: enabled && query.isPending, error: query.error };
}

/**
 * Resolve a group key to the obs that should be focused when jumping to it:
 * the first peer along the variant axis. Used by the group cursor's prev/next.
 */
export async function firstObsOfGroup(
  coordinator: Coordinator,
  groupBy: string,
  variantBy: string,
  groupValue: GroupValue,
): Promise<RowIndex | null> {
  const literal = literalOf(groupValue);
  const sql =
    `SELECT ${ident("__row_index__")} AS row_index FROM dataset ` +
    `WHERE ${ident(groupBy)} = ${literal} ORDER BY ${ident(variantBy)} ASC LIMIT 1`;
  const rows = toRows<{ row_index: number }>(await coordinator.query(sql, { type: "json" }));
  const first = rows[0];
  return first ? rowIndex(first.row_index) : null;
}
