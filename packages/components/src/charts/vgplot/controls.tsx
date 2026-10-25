/** vgplot control strip: column + mark pickers, mounted by the imperative body into its own React root. */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import type { ColumnType } from "../../query/column-types";
import { FieldPicker } from "../core/field-picker";
import { MARK_PRESETS, PRESET_COLUMN_KINDS, type MarkPreset } from "./spec-schema";

const PRESET_LABELS: Record<MarkPreset, string> = {
  histogram: "Histogram",
  count: "Count",
};

interface Props {
  columns: ReadonlyMap<string, ColumnType> | null;
  field: string | null;
  preset: MarkPreset;
  placeholder: string;
  onField: (field: string) => void;
  onPreset: (preset: MarkPreset) => void;
}

export function VgplotControls({ columns, field, preset, placeholder, onField, onPreset }: Props) {
  return (
    <>
      <FieldPicker
        types={columns}
        value={field}
        kinds={PRESET_COLUMN_KINDS[preset]}
        placeholder={placeholder}
        onPick={onField}
      />
      <Select
        items={PRESET_LABELS}
        value={preset}
        onValueChange={(next) => {
          if (next) onPreset(next);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MARK_PRESETS.map((name) => (
            <SelectItem key={name} value={name}>
              {PRESET_LABELS[name]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
