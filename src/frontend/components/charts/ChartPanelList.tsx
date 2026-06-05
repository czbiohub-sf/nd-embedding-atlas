import type { ReactNode } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import type { ChartSpec } from "../../types";
import { ChartPanel } from "./ChartPanel";
import { CountPlot } from "./CountPlot";
import { Histogram } from "./Histogram";

function titleFor(spec: ChartSpec): string {
  switch (spec.type) {
    case "count-plot":
      return spec.field;
    case "histogram":
      return spec.field;
    case "scatter":
      return `${spec.xField} vs ${spec.yField}`;
    case "boxplot":
      return spec.field;
    default:
      return "Chart";
  }
}

function renderChart(spec: ChartSpec): ReactNode {
  switch (spec.type) {
    case "count-plot":
      return <CountPlot field={spec.field} limit={spec.limit} />;
    case "histogram":
      return <Histogram field={spec.field} bins={spec.bins} />;
    default:
      return <div className="py-1 text-3xs text-text-muted">Unsupported chart type: {spec.type}</div>;
  }
}

export function ChartPanelList() {
  const { state } = useDashboard();

  if (state.panels.length === 0) {
    return <div className="p-3 text-text-muted text-xs">No charts configured</div>;
  }

  return (
    <>
      {state.panels.map((panel) => (
        <ChartPanel key={panel.id} id={panel.id} title={titleFor(panel.spec)}>
          {renderChart(panel.spec)}
        </ChartPanel>
      ))}
    </>
  );
}
