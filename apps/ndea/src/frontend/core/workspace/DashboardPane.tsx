/**
 * The dashboard: json-render renders the active layout's spec with the
 * dashboard registry (`dashboard-registry.tsx`: layout, tiles, ghost tiles).
 * Props resolve json-render expressions against the document's coordination
 * `state`. While the harness proposes new tiles, the grid renders the
 * proposal preview. The pane owns the tile drag (`tile-drag.ts`) and the
 * fullscreen overlay.
 */

import { JSONUIProvider, Renderer } from "@json-render/react";
import { use, useMemo } from "react";

import { ProposalsContext } from "@/core/proposals/harness";
import { activeSpec } from "./dashboard";
import { REGISTRY, renderSpec } from "./dashboard-registry";
import { FullscreenOverlay } from "./FullscreenOverlay";
import { TileDragContext, useTileDragController } from "./tile-drag";
import { applyOrToast, useWorkspace, useWorkspaceSelector } from "./workspace-context";

export function DashboardPane() {
  const ws = useWorkspace();
  const committed = useWorkspaceSelector((w) => activeSpec(w.snapshot()));
  const ghostDoc = use(ProposalsContext)?.preview.document;
  const spec = ghostDoc ? activeSpec(ghostDoc) : committed;
  const rendered = useMemo(() => renderSpec(spec), [spec]);
  const tileDrag = useTileDragController((edit) => applyOrToast(ws, [edit]));

  return (
    <TileDragContext value={tileDrag}>
      <JSONUIProvider registry={REGISTRY} store={ws.coordination.stateStore}>
        <div className="relative flex h-full min-h-0 min-w-0">
          <Renderer spec={rendered} registry={REGISTRY} />
          <FullscreenOverlay />
        </div>
      </JSONUIProvider>
    </TileDragContext>
  );
}
