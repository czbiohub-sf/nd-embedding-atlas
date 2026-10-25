/**
 * Minimal column picker for a chart component. The caller sources column
 * types from its own coordinator: no `useDashboard`.
 *
 * ponytail: skip only `__row_index__`. Embedding/coord-column noise filtering
 * is YAGNI for a manual pick: the user chooses. Add a skip heuristic only if
 * the list proves noisy.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import type { ColumnType } from "../../query/column-types";

const SKIP = new Set(["__row_index__"]);

interface Props {
  /** Column name → type; null while loading. */
  types: ReadonlyMap<string, ColumnType> | null;
  value: string | null;
  /** Column types this chart variant can plot (string/boolean vs number). */
  kinds: readonly ColumnType[];
  onPick: (field: string) => void;
  /** Overrides the empty-state label (defaults to pick/loading). */
  placeholder?: string;
}

export function FieldPicker({ types, value, kinds, onPick, placeholder }: Props) {
  const eligible = types
    ? [...types.entries()].filter(([name, t]) => kinds.includes(t) && !SKIP.has(name)).map(([name]) => name)
    : [];

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onPick(next);
      }}
    >
      <SelectTrigger className="w-full font-mono">
        <SelectValue placeholder={placeholder ?? (types ? "Pick a column…" : "Loading columns…")} />
      </SelectTrigger>
      <SelectContent>
        {eligible.map((name) => (
          <SelectItem key={name} value={name} className="font-mono">
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
