/** The fullscreen view's body reparents here, in the same tile chrome; esc hands it back. */

import { IconButton } from "@ndea/ui/components/icon-button";
import { Maximize2 } from "lucide-react";
import { useEffect } from "react";

import { BodySocket } from "./body-dock";
import { elementTitle } from "./dashboard";
import { TILE_FRAME, TILE_HEADER } from "./Tile";
import { useWorkspace, useWorkspaceSelector, useWorkspaceSession } from "./workspace-context";

export function FullscreenOverlay() {
  const ws = useWorkspace();
  const id = useWorkspaceSession((s) => s.fullscreen);
  const element = useWorkspaceSelector((w) => (id ? w.element(id) : undefined));

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      ws.setFullscreen(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [id, ws]);

  if (!id || !element) return null;
  return (
    <div className="absolute inset-0 z-30 flex bg-background">
      <div className={TILE_FRAME}>
        <div className={TILE_HEADER}>
          <div role="tablist" className="inline-flex min-w-0 items-center rounded-md bg-muted p-0.5">
            <span
              role="tab"
              aria-selected
              className="min-w-0 truncate rounded-sm bg-card px-2 py-0.5 font-medium text-foreground text-ui shadow-(--shadow-raised)"
            >
              {elementTitle(element)}
            </span>
          </div>
          <span className="flex-1" />
          <IconButton size="md" label="Exit fullscreen" pressed onClick={() => ws.setFullscreen(null)}>
            <Maximize2 strokeWidth={1.5} />
          </IconButton>
        </div>
        <BodySocket id={id} className="flex min-h-0 flex-1 flex-col overflow-hidden" />
      </div>
    </div>
  );
}
