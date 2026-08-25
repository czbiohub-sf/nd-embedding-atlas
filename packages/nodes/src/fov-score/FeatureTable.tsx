/**
 * The knob table: every feature's direction, shape, parameters and weight as typed values.
 *
 * The plots are for tuning by eye; this is for entering the number you already know, reading
 * back exactly what will be exported, and reaching parameters that have no handle (a
 * sigmoid's `width`, a gaussian's `beta`). Both edit the same config, so a drag moves the
 * cell and typing in the cell moves the curve.
 */

import { useState } from "react";
import { Button } from "@ndea/ui/components/button";
import { Input } from "@ndea/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { formatNumber } from "./CurvePlot";
import { defaultParams, type FeatureStats } from "./defaults";
import { DIRECTIONS, type Direction, type FeatureSpec, SHAPES, type Shape } from "./desirability";

/**
 * `_desirability` ignores `direction` for the bells — they are symmetric about their centre —
 * so offering the control there would imply a knob that does nothing, and `yaml.ts` will not
 * emit it either.
 */
const DIRECTION_APPLIES = new Set<Shape>(["linear", "sigmoid"]);

export interface FeatureTableProps {
  names: readonly string[];
  features: Readonly<Record<string, FeatureSpec>>;
  stats: Readonly<Record<string, FeatureStats>>;
  onSpec: (name: string, spec: FeatureSpec) => void;
}

/**
 * A numeric cell that does not fight the keyboard.
 *
 * A plain controlled input reformats on every keystroke, so typing `0.05` becomes `0.05` →
 * `0` → `0.05` and an intermediate `1e` or `-` is rejected outright. Local text while
 * focused, formatted value otherwise: the field tracks a drag when you are not in it, and
 * lets you type freely when you are.
 */
function NumberField({ value, title, onCommit }: { value: number; title: string; onCommit: (next: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      type="text"
      inputMode="decimal"
      title={title}
      aria-label={title}
      className="h-5 w-[70px] px-1 font-mono text-[0.625rem]"
      value={text ?? formatNumber(value)}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = Number(text);
        if (text != null && text.trim() !== "" && Number.isFinite(next)) onCommit(next);
        setText(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setText(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function FeatureTable({ names, features, stats, onSpec }: FeatureTableProps) {
  return (
    <div className="min-h-0 overflow-auto">
      <table className="w-full border-collapse font-mono text-2xs">
        <thead className="sticky top-0 bg-node-surface text-muted-foreground">
          <tr className="border-border/40 border-b">
            <th className="w-6 px-1 py-1 text-left font-normal" />
            <th className="px-1 py-1 text-left font-normal">feature</th>
            <th className="px-1 py-1 text-left font-normal">shape</th>
            <th className="px-1 py-1 text-left font-normal">direction</th>
            <th className="px-1 py-1 text-left font-normal">params</th>
            <th className="w-20 px-1 py-1 text-left font-normal">weight</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => {
            const spec = features[name];
            if (!spec) return null;
            const stat = stats[name];
            const patch = (next: Partial<FeatureSpec>) => onSpec(name, { ...spec, ...next });
            return (
              <tr key={name} className={`border-border/20 border-b ${spec.enabled ? "" : "opacity-40"}`}>
                <td className="px-1 py-0.5">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant={spec.enabled ? "secondary" : "ghost"}
                    aria-pressed={spec.enabled}
                    title={spec.enabled ? "Exclude from the score" : "Include in the score"}
                    onClick={() => patch({ enabled: !spec.enabled })}
                  >
                    {spec.enabled ? "✓" : ""}
                  </Button>
                </td>
                <td className="max-w-[180px] truncate px-1 py-0.5" title={name}>
                  {name}
                </td>
                <td className="px-1 py-0.5">
                  <Select
                    value={spec.shape}
                    onValueChange={(value) => {
                      const shape = value as Shape;
                      // Shapes do not share a parameter vocabulary, so carrying the old keys
                      // across would leave `curveBounds` reading undefined. Re-place the
                      // curve over the data instead.
                      patch({ shape, params: defaultParams(shape, spec.direction, stat) });
                    }}
                  >
                    <SelectTrigger aria-label={`${name} shape`} className="h-5 w-[92px] px-1 text-[0.625rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHAPES.map((shape) => (
                        <SelectItem key={shape} value={shape}>
                          {shape}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-1 py-0.5">
                  {DIRECTION_APPLIES.has(spec.shape) ? (
                    <Select
                      value={spec.direction}
                      onValueChange={(value) => {
                        const direction = value as Direction;
                        patch({ direction, params: defaultParams(spec.shape, direction, stat) });
                      }}
                    >
                      <SelectTrigger aria-label={`${name} direction`} className="h-5 w-[80px] px-1 text-[0.625rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DIRECTIONS.map((direction) => (
                          <SelectItem key={direction} value={direction}>
                            {direction}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-muted-foreground/40" title="symmetric shape: direction has no effect">
                      n/a
                    </span>
                  )}
                </td>
                <td className="px-1 py-0.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {Object.keys(spec.params).map((key) => (
                      <label key={key} className="flex items-center gap-0.5 text-muted-foreground">
                        <span className="text-[0.625rem]">{key}</span>
                        <NumberField
                          value={spec.params[key]}
                          title={`${name} ${key}`}
                          onCommit={(next) => patch({ params: { ...spec.params, [key]: next } })}
                        />
                      </label>
                    ))}
                  </div>
                </td>
                <td className="px-1 py-0.5">
                  <NumberField
                    value={spec.weight}
                    title={`${name} weight`}
                    onCommit={(next) => patch({ weight: Math.max(next, 0) })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
