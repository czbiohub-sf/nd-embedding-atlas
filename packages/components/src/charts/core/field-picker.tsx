/**
 * Minimal column picker for a chart component, over the column catalog.
 *
 * ponytail: every catalog column of a plottable type. Embedding/coord-column
 * noise filtering is YAGNI for a manual pick: the user chooses. Add a skip
 * heuristic only if the list proves noisy.
 */

import type { ColumnType } from "@ndea/protocol";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import type { Columns } from "../../query/columns";

interface Props {
  /** The column catalog; null while loading. */
  columns: Columns | null;
  value: string | null;
  /** Column types this chart variant can plot (string/boolean vs number). */
  kinds: readonly ColumnType[];
  onPick: (field: string) => void;
  /** Overrides the empty-state label (defaults to pick/loading). */
  placeholder?: string;
}

export function FieldPicker({ columns, value, kinds, onPick, placeholder }: Props) {
  const eligible = columns ? [...columns.values()].filter((c) => kinds.includes(c.type)).map((c) => c.name) : [];

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onPick(next);
      }}
    >
      <SelectTrigger className="w-full font-mono">
        <SelectValue placeholder={placeholder ?? (columns ? "Pick a column…" : "Loading columns…")} />
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
