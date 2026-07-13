/**
 * Minimal column picker for a chart node. Revive-as-node needs a per-instance
 * field source (the old `generateDefaultPanels` supplied one panel per column;
 * that path is gone). Sources eligible columns from `useColumnTypes` over the
 * node's own coordinator — no `useDashboard`.
 *
 * ponytail: native <select>, skip only `__row_index__`. Embedding/coord-column
 * noise filtering is YAGNI for a manual pick — the user chooses. Add a skip
 * heuristic only if the list proves noisy.
 */

import type { Coordinator } from "@uwdata/mosaic-core";
import { type ColumnType, useColumnTypes } from "@/hooks/useColumnTypes";

const SKIP = new Set(["__row_index__"]);

interface Props {
  coordinator: Coordinator;
  value: string | null;
  /** Column types this chart variant can plot (string/boolean vs number). */
  kinds: readonly ColumnType[];
  onPick: (field: string) => void;
}

export function FieldPicker({ coordinator, value, kinds, onPick }: Props) {
  const types = useColumnTypes(coordinator);
  const eligible = types
    ? [...types.entries()].filter(([name, t]) => kinds.includes(t) && !SKIP.has(name)).map(([name]) => name)
    : [];

  return (
    <select
      className="w-full rounded-sm border border-border bg-card px-1.5 py-1 font-mono text-2xs text-muted-foreground"
      value={value ?? ""}
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
    >
      <option value="" disabled>
        {types ? "Pick a column…" : "Loading columns…"}
      </option>
      {eligible.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}
