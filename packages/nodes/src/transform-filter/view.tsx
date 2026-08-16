import { useEffect, useMemo, useState } from "react";
import type {
  NodeBodyProps,
  ThresholdFilterConfig,
  TransformFilterCapabilities,
  TransformFilterColumnTypesService,
} from "./contracts";

interface ThresholdFilterViewProps extends NodeBodyProps<ThresholdFilterConfig, TransformFilterCapabilities> {
  readonly getColumnTypes: TransformFilterColumnTypesService;
}

export function ThresholdFilterView({ host, getColumnTypes }: ThresholdFilterViewProps) {
  const columnTypes = getColumnTypes(host.data.coordinator);
  const numericColumns = useMemo(
    () => (columnTypes ? [...columnTypes].filter(([, type]) => type === "number").map(([column]) => column) : []),
    [columnTypes],
  );

  const [column, setColumn] = useState<string | null>(host.config.column);
  const [threshold, setThreshold] = useState<number>(host.config.threshold);

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
          onChange={(event) => {
            const next = event.target.value || null;
            setColumn(next);
            host.patchConfig({ column: next });
          }}
        >
          <option value="">: select :</option>
          {numericColumns.map((name) => (
            <option key={name} value={name}>
              {name}
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
          onChange={(event) => {
            const next = Number(event.target.value);
            setThreshold(next);
            host.patchConfig({ threshold: next });
          }}
        />
      </label>
    </div>
  );
}

export function createThresholdFilterView(getColumnTypes: TransformFilterColumnTypesService) {
  return function ConfiguredThresholdFilterView({
    host,
  }: NodeBodyProps<ThresholdFilterConfig, TransformFilterCapabilities>) {
    return <ThresholdFilterView host={host} getColumnTypes={getColumnTypes} />;
  };
}
