import type { IDockviewPanelProps } from "dockview-react";
import { panelId } from "../../../scatter-gpu/types";
import { ScatterContent } from "../../scatter/ScatterContent";

// Re-export for backwards compat (used by FloatingScatterWindow)
export { hexToRgbPalette } from "../../../scatter-gpu/utils/colors";

export function ScatterPanel(props: IDockviewPanelProps) {
  return (
    <ScatterContent
      panelId={panelId(props.api.id)}
      initialObsmKey={(props.params as { initialObsmKey?: string } | undefined)?.initialObsmKey}
      panelApi={props.api}
    />
  );
}
