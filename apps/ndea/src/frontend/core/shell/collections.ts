/**
 * Collections: the project's groups of datasets (`collections:` in the project
 * YAML). The server holds one collection; its datasets are a filter, a
 * `_dataset` clause under source `dataset` in filter scope A (one dataset:
 * `eq`; several: `in`; all: cleared). Another collection is a switch: the
 * server clears the dataset filter, re-ingests, and every tab reloads
 * (`session/watch`).
 */

import { Store } from "@tanstack/store";

import type { CollectionSummary } from "@ndea/protocol";

import { useWorkspace, useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import type { MenuGroup } from "./CommandMenu";

export const obs = (n: number) => `${n.toLocaleString("en-US")} obs`;
export const totalObs = (collection: CollectionSummary) => collection.datasets.reduce((sum, d) => sum + d.nObs, 0);

/** The switch awaiting confirmation (`CollectionSwitchDialog`). */
export const pendingSwitch = new Store({ name: "", open: false });

/** Ask to switch to collection `name`; the confirm dialog does it. */
const requestSwitch = (name: string) => pendingSwitch.setState(() => ({ name, open: true }));

/** The project's collections, the open one, and the open collection's dataset filter. */
export function useCollections() {
  const ws = useWorkspace();
  const { metadata } = useDatasetSession().state;
  const clause = useWorkspaceSelector((w) => w.snapshot().state.filter?.A?.dataset?.dataset);
  const collections = metadata.collections ?? [];
  const open = collections.find((c) => c.name === metadata.collection);
  const names = open?.datasets.map((d) => d.name) ?? [];
  /** Included datasets of the open collection; null = all (no clause). */
  const included =
    clause?.op === "eq"
      ? new Set([String(clause.value)])
      : clause?.op === "in"
        ? new Set(clause.values.map(String))
        : null;
  const setIncluded = (values: readonly string[] | null) => {
    const all = values === null || names.every((name) => values.includes(name));
    ws.apply([
      {
        op: "set_filter",
        scope: "A",
        source: "dataset",
        facet: "dataset",
        clause: all
          ? null
          : values.length === 1
            ? { op: "eq", column: "_dataset", value: values[0] }
            : { op: "in", column: "_dataset", values: [...values] },
      },
    ]);
  };
  /** Include or exclude one dataset; the last included one stays. */
  const toggle = (name: string) => {
    const current = included ?? new Set(names);
    const next = names.filter((n) => (n === name ? !current.has(n) : current.has(n)));
    if (next.length > 0) setIncluded(next);
  };
  return { collections, open, included, setIncluded, toggle, requestSwitch };
}

/** ⌘K's Collections group: the open collection's datasets filter, any other row switches. Null with nothing to pick. */
export function useCollectionsGroup(): MenuGroup | null {
  const { collections, open, included, setIncluded } = useCollections();
  if (collections.length <= 1 && (open?.datasets.length ?? 0) <= 1) return null;
  return {
    heading: "Collections",
    meta: `${collections.length} ${collections.length === 1 ? "collection" : "collections"}`,
    items: collections.map((c) => {
      const isOpen = c === open;
      return {
        id: `collection:${c.name}`,
        label: c.name,
        sub: `${c.datasets.length} ${c.datasets.length === 1 ? "dataset" : "datasets"} · ${obs(totalObs(c))}`,
        current: isOpen,
        onSelect: () => (isOpen ? setIncluded(null) : requestSwitch(c.name)),
        children: c.datasets.map((d) => ({
          id: `collection:${c.name}/${d.name}`,
          label: d.name,
          meta: obs(d.nObs),
          current: isOpen && included?.size === 1 && included.has(d.name),
          onSelect: () => (!isOpen ? requestSwitch(c.name) : c.datasets.length > 1 && setIncluded([d.name])),
        })),
      };
    }),
  };
}
