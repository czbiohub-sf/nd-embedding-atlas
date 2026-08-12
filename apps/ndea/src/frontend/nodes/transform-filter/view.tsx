/**
 * Threshold-filter transform plugin (node-graph tracer bullet).
 *
 * The first `kind: "transform"` plugin: a numeric threshold filter. It proves the
 * transform half of the plugin contract drives the GraphEngine: the engine cooks
 * this node by calling `recompute(inputs, ctx)`, which reads its column + threshold
 * from persisted config; graph cooking emits the resulting predicate.
 *
 * `Component` is the param editor (the node body). It is xyflow-agnostic: the
 * canvas node wrapper supplies the Handles: so the same Component would mount
 * docked / float / PiP, the contract's "one Component, four surfaces" promise.
 */

import { useEffect, useMemo, useState } from "react";
import { useColumnTypes } from "@/hooks/useColumnTypes";
import type { NodeBodyProps } from "@/core/node/app-node-host";
import type { TransformFilterCapabilities } from "./plugin";

export interface ThresholdFilterConfig {
  /** Numeric obs column to threshold on; null until the schema resolves. */
  column: string | null;
  threshold: number;
}

export type ThresholdFilterOptions = Record<never, never>;

export function ThresholdFilterView({ host }: NodeBodyProps<ThresholdFilterConfig, TransformFilterCapabilities>) {
  const columnTypes = useColumnTypes(host.data.coordinator);
  const numericColumns = useMemo(
    () => (columnTypes ? [...columnTypes].filter(([, t]) => t === "number").map(([c]) => c) : []),
    [columnTypes],
  );

  const [column, setColumn] = useState<string | null>(host.config.column);
  const [threshold, setThreshold] = useState<number>(host.config.threshold);

  // Auto-select the first numeric column once the schema resolves.
  useEffect(() => {
    if (column === null && numericColumns.length > 0) {
      const first = numericColumns[0];
      setColumn(first);
      host.patchConfig({ column: first });
    }
  }, [column, numericColumns, host]);

  return (
    <div className="flex w-52 flex-col gap-2 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Column</span>
        <select
          className="rounded border border-border bg-background px-2 py-1"
          value={column ?? ""}
          onChange={(e) => {
            const next = e.target.value || null;
            setColumn(next);
            host.patchConfig({ column: next });
          }}
        >
          <option value="">: select :</option>
          {numericColumns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Threshold &gt;</span>
        <input
          type="number"
          className="rounded border border-border bg-background px-2 py-1"
          value={threshold}
          onChange={(e) => {
            const next = Number(e.target.value);
            setThreshold(next);
            host.patchConfig({ threshold: next });
          }}
        />
      </label>
    </div>
  );
}
