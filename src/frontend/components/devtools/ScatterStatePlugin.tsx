/**
 * ScatterStatePlugin — live view of the selection-sync + view-sync stores.
 * Rendered as a tab inside TanStackDevtools.
 */

import { useSelector } from "@tanstack/react-store";
import { getBitmapRowIds } from "../../stores/RoaringBroadcastStore";
import { selectionSyncStore } from "../../stores/SelectionSyncStore";
import { viewSyncStore } from "../../stores/ViewSyncStore";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-glass-border border-b px-4 py-2 text-xs">
      <span className="w-40 shrink-0 font-mono text-foreground/40">{label}</span>
      <span className="min-w-0 break-all font-mono text-foreground/80">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="sticky top-0 bg-card px-4 py-1.5 font-semibold text-3xs text-foreground/30 uppercase tracking-widest">
        {title}
      </div>
      {children}
    </div>
  );
}

export function ScatterStatePlugin() {
  const selection = useSelector(selectionSyncStore, (s) => s);
  const view = useSelector(viewSyncStore, (s) => s);

  return (
    <div className="h-full overflow-y-auto bg-card text-foreground">
      <Section title="Selection Sync Store">
        <Row
          label="type"
          value={
            <span className={selection.type === "active" ? "text-primary" : "text-foreground/30"}>
              {selection.type}
            </span>
          }
        />
        {selection.type === "active" && (
          <>
            <Row label="source" value={JSON.stringify(selection.source)} />
            <Row label="version" value={<span className="text-primary">{selection.version}</span>} />
            {(() => {
              const ids = getBitmapRowIds(selection.source);
              return (
                <>
                  <Row
                    label="bitmap.size"
                    value={<span className="text-primary">{ids.length.toLocaleString()}</span>}
                  />
                  <Row label="bitmap[0..4]" value={`[${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", …" : ""}]`} />
                </>
              );
            })()}
          </>
        )}
      </Section>

      <Section title="View Sync Store">
        <Row
          label="lockMode"
          value={
            <span className={view.lockMode === "linked" ? "text-primary" : "text-foreground/30"}>{view.lockMode}</span>
          }
        />
        <Row label="sourcePanelId" value={view.sourcePanelId ?? <span className="text-foreground/20">null</span>} />
        <Row label="panX" value={view.panX.toFixed(4)} />
        <Row label="panY" value={view.panY.toFixed(4)} />
        <Row label="zoom" value={view.zoom.toFixed(3)} />
      </Section>
    </div>
  );
}
