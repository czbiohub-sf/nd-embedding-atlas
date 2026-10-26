/**
 * Collections: the project's groups of datasets (`collections:` in the project
 * YAML). The server holds one collection; its datasets are a filter, a
 * `_dataset` clause under source `dataset` in filter scope A (one dataset:
 * `eq`; several: `in`; all: cleared). Another collection is a switch: the
 * server clears the dataset filter, re-ingests, and every tab reloads
 * (`session/watch`). Data only; the Data flyout and ⌘K each render it.
 */

import { Store } from "@tanstack/store";

import type { CollectionSummary } from "@ndea/protocol";

import type { DashboardEdit } from "@/core/workspace/edits";
import { useWorkspace, useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { useDatasetSession } from "@/hooks/useDatasetSession";

export const obs = (n: number) => `${n.toLocaleString("en-US")} obs`;
export const totalObs = (collection: CollectionSummary) => collection.datasets.reduce((sum, d) => sum + d.nObs, 0);

/** The switch awaiting confirmation (`CollectionSwitchDialog`). */
export const pendingSwitch = new Store({ name: "", open: false });

/** Ask to switch to collection `name`; the confirm dialog does it. */
export const requestSwitch = (name: string) => pendingSwitch.setState(() => ({ name, open: true }));

/** The edit that includes `values` of the open collection's datasets `names`; null (or every name) clears the filter. */
export function datasetFilterEdit(names: readonly string[], values: readonly string[] | null): DashboardEdit {
  const all = values === null || names.every((name) => values.includes(name));
  return {
    op: "set_filter",
    scope: "A",
    source: "dataset",
    facet: "dataset",
    clause: all
      ? null
      : values.length === 1
        ? { op: "eq", column: "_dataset", value: values[0] }
        : { op: "in", column: "_dataset", values: [...values] },
  };
}

export interface Collections {
  collections: CollectionSummary[];
  /** The collection the server holds. */
  open: CollectionSummary | undefined;
  /** Included datasets of the open collection; null = all (no clause). */
  included: ReadonlySet<string> | null;
}

/** The project's collections, the open one, and the open collection's dataset filter, with its setters. */
export function useCollections() {
  const ws = useWorkspace();
  const { metadata } = useDatasetSession().state;
  const clause = useWorkspaceSelector((w) => w.snapshot().state.filter?.A?.dataset?.dataset);
  const collections = metadata.collections ?? [];
  const open = collections.find((c) => c.name === metadata.collection);
  const names = open?.datasets.map((d) => d.name) ?? [];
  const included =
    clause?.op === "eq"
      ? new Set([String(clause.value)])
      : clause?.op === "in"
        ? new Set(clause.values.map(String))
        : null;
  const setIncluded = (values: readonly string[] | null) => ws.apply([datasetFilterEdit(names, values)]);
  /** Include or exclude one dataset; the last included one stays. */
  const toggle = (name: string) => {
    const current = included ?? new Set(names);
    const next = names.filter((n) => (n === name ? !current.has(n) : current.has(n)));
    if (next.length > 0) setIncluded(next);
  };
  return { collections, open, included, setIncluded, toggle };
}
