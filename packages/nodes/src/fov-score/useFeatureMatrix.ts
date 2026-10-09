/**
 * The whole pre-scan feature matrix, in one query.
 *
 * Features live in obs (the converter writes them to both `X` and obs for exactly this), so
 * every feature, the label and the row id come back together. Reading them out of `X` would
 * mean materialising one var column per feature through `/api/var-column`, each an async task
 * with a status poll — fifteen round trips to fetch a 147x15 matrix that fits in a packet.
 *
 * Not scoped to the node's input predicate: tuning a score function is a whole-dataset
 * activity, and scoring a crossfiltered subset would make the accuracy readout depend on
 * whatever happened to be selected elsewhere.
 */

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Coordinator } from "@uwdata/mosaic-core";
import { annotationCacheSuffix, useRefetchOnAnnotationWrite } from "../query/annotations";
import { toRows } from "../query/mosaic";
import { GOODNESS_COLUMN, GOODNESS_USER_COLUMN, type Goodness, parseGoodness } from "../fov-label/goodness";

export interface FeatureRow {
  /** Human-readable FOV id (e.g. `B/3/000000`), when the dataset declares one. */
  name: string;
  rowIndex: number;
  /** Feature name → measured value; non-finite means the feature could not be measured. */
  values: Record<string, number>;
  /** `goodness_user` if the operator has labelled it here, else the imported `goodness`. */
  goodness: Goodness;
}

export interface FeatureMatrix {
  rows: readonly FeatureRow[];
  isLoading: boolean;
  error: string | null;
  /** Re-read in place; see usePlateFovs.refetch for why this is not a key bump. */
  refetch: () => void;
}

/** Non-numeric cells become NaN, which the model charges for rather than treating as zero. */
function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return Number.NaN;
}

export interface FeatureMatrixQuery {
  coordinator: Coordinator;
  /** `metadata.obs_columns`. */
  columns: readonly string[];
  features: readonly string[];
  /** Spatial FOV column, so a focused row can be named the way the plate grid names it. */
  nameColumn: string | null;
  /**
   * Annotation columns from `/api/annotations/columns`.
   *
   * `metadata.obs_columns` never lists these, so gating on it alone means a label made in the
   * plate grid is never read here and the accuracy readout scores against the import only.
   */
  annotationColumns: readonly string[];
  annotationRevision: number;
  annotationsReady: boolean;
}

export function useFeatureMatrix({
  coordinator,
  columns,
  features,
  nameColumn,
  annotationColumns,
  annotationRevision,
  annotationsReady,
}: FeatureMatrixQuery): FeatureMatrix {
  const hasImported = columns.includes(GOODNESS_COLUMN);
  const hasUser = annotationColumns.includes(GOODNESS_USER_COLUMN) || columns.includes(GOODNESS_USER_COLUMN);
  const key = features.join(",");

  const nameOn = nameColumn && columns.includes(nameColumn) ? nameColumn : null;

  const query = useQuery<FeatureRow[]>({
    queryKey: ["fov-score-matrix", key, hasImported, hasUser, nameOn],
    enabled: features.length > 0 && annotationsReady,
    queryFn: async () => {
      const selected = ["__row_index__", ...features.map((f) => `"${f}"`)];
      if (nameOn) selected.push(`"${nameOn}"`);
      if (hasImported) selected.push(`"${GOODNESS_COLUMN}"`);
      if (hasUser) selected.push(`"${GOODNESS_USER_COLUMN}"`);

      const result = await coordinator.query(
        `SELECT ${selected.join(", ")} FROM dataset ORDER BY __row_index__${annotationCacheSuffix(annotationRevision)}`,
        { type: "json" },
      );

      return toRows(result).map((row) => {
        const values: Record<string, number> = {};
        for (const name of features) values[name] = asNumber(row[name]);
        const user = hasUser ? parseGoodness(row[GOODNESS_USER_COLUMN]) : "unlabeled";
        const imported = hasImported ? parseGoodness(row[GOODNESS_COLUMN]) : "unlabeled";
        const index = Number(row.__row_index__);
        return {
          // Fall back to the row index so a focused FOV is always identifiable, even in a
          // dataset with no spatial FOV column.
          name: nameOn && typeof row[nameOn] === "string" ? row[nameOn] : `row ${index}`,
          rowIndex: index,
          values,
          goodness: user !== "unlabeled" ? user : imported,
        };
      });
    },
  });

  const refetch = useCallback(() => void query.refetch(), [query]);
  // Labels are made in the plate grid, not here, so following other nodes' writes is the
  // entire point: the histograms and the accuracy readout must move when a FOV is relabelled.
  useRefetchOnAnnotationWrite(annotationRevision, refetch);

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error ? String(query.error) : null,
    refetch,
  };
}
