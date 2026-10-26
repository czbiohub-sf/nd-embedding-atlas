/**
 * The dashboard: the active layout's spec rendered from its root by the
 * dashboard renderer (`dashboard-registry.tsx`: layout, tiles, ghost tiles).
 * While the harness proposes new tiles, the grid renders the proposal
 * preview. The pane owns the tile drag (`tile-drag.ts`) and the fullscreen
 * overlay.
 */

import { use } from "react";

import { ProposalsContext } from "@/core/proposals/harness";
import { activeSpec } from "./dashboard";
import { SpecElement } from "./dashboard-registry";
import { FullscreenOverlay } from "./FullscreenOverlay";
import { TileDragContext, useTileDragController } from "./tile-drag";
import { applyOrToast, useWorkspace, useWorkspaceSelector } from "./workspace-context";

export function DashboardPane() {
  const ws = useWorkspace();
  const committed = useWorkspaceSelector((w) => activeSpec(w.snapshot()));
  const ghostDoc = use(ProposalsContext)?.preview.document;
  const spec = ghostDoc ? activeSpec(ghostDoc) : committed;
  const tileDrag = useTileDragController((edit) => applyOrToast(ws, [edit]));

  return (
    <TileDragContext value={tileDrag}>
      <div className="relative flex h-full min-h-0 min-w-0">
        <SpecElement spec={spec} id={spec.root} />
        <FullscreenOverlay />
      </div>
    </TileDragContext>
  );
}
