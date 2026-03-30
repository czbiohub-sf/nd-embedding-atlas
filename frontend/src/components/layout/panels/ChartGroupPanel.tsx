import type { IDockviewPanelProps } from "dockview-react";
import { ChartPanelList } from "../../charts/ChartPanelList";

export function ChartGroupPanel(_props: IDockviewPanelProps) {
  return (
    <div className="h-full w-full overflow-y-auto bg-surface">
      <ChartPanelList />
    </div>
  );
}
