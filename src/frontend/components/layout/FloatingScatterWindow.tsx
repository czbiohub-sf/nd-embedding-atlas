/**
 * FloatingScatterWindow — renders floating scatter panels at DashboardShell level.
 *
 * Uses ScatterContent directly — same component as docked panels, just a different container.
 * Supports optional axis sync from a linked docked panel via PanelStateStore.
 */

import { useStore } from "@tanstack/react-store";
import { Link2OffIcon, LinkIcon } from "lucide-react";
import { useEffect } from "react";
import { useFloatingWindow } from "../../hooks/useFloatingWindow";
import { panelId } from "../../scatter-gpu/types";
import { floatingScatterStore, removeFloatingScatter, setFloatingScatterLink } from "../../stores/FloatingScatterStore";
import { panelStateStore } from "../../stores/PanelStateStore";
import { FloatingWindow } from "../FloatingWindow";
import { ScatterContent } from "../scatter/ScatterContent";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// ── One floating window per store entry ──────────────────────────────────────

function FloatingScatterItem({ entryId }: { entryId: string }) {
  const entry = useStore(floatingScatterStore, (s) => s.find((e) => e.id === entryId));
  const fw = useFloatingWindow({ initialWidth: 440, initialHeight: 440 });

  // Resolve synced axes from linked panel
  const linkedState = useStore(panelStateStore, (s) => (entry?.linkedPanelId ? s.get(entry.linkedPanelId) : undefined));

  useEffect(() => {
    fw.open();
  }, [fw.open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!entry) return null;

  const title = entry.axes.obsmKey.replace(/^X_/, "");
  const isLinked = !!entry.linkedPanelId;
  const linkedPanelExists = isLinked && linkedState !== undefined;

  // Link toggle button rendered in FloatingWindow title area via extra prop
  const linkButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() =>
              setFloatingScatterLink(
                entryId,
                isLinked
                  ? undefined
                  : Object.keys(
                      // Link to the first non-float panel available
                      Object.fromEntries(
                        Array.from(panelStateStore.state.entries()).filter(([k]) => !k.startsWith("float-")),
                      ),
                    )[0],
              )
            }
            className={`flex size-4 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground ${isLinked && linkedPanelExists ? "text-primary" : ""}`}
          />
        }
      >
        {isLinked ? <LinkIcon className="size-3" /> : <Link2OffIcon className="size-3" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">{isLinked ? "Unlink from panel" : "Sync from panel"}</TooltipContent>
    </Tooltip>
  );

  return (
    <FloatingWindow
      handle={{
        ...fw,
        close: () => {
          fw.close();
          removeFloatingScatter(entryId);
        },
      }}
      title={`${title}${isLinked && linkedPanelExists ? " ↔" : ""}`}
      extraTitleActions={linkButton}
    >
      <ScatterContent
        panelId={panelId(`float-${entryId}`)}
        initialObsmKey={entry.axes.obsmKey}
        initialColorByColumn={entry.colorByColumn}
        syncedAxes={linkedPanelExists ? linkedState?.axes : undefined}
      />
    </FloatingWindow>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function FloatingScatterRoot() {
  const entries = useStore(floatingScatterStore, (s) => s);
  return (
    <>
      {entries.map((e) => (
        <FloatingScatterItem key={e.id} entryId={e.id} />
      ))}
    </>
  );
}
