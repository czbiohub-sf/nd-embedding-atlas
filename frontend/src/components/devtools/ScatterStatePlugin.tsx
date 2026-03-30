/**
 * ScatterStatePlugin — live view of the three TanStack Store singletons.
 * Rendered as a tab inside TanStackDevtools.
 */

import { useStore } from "@tanstack/react-store";
import { brushPredicateStore } from "../../providers/BrushPredicateStore";
import { selectionSyncStore } from "../../providers/SelectionSyncStore";
import { getBitmapRowIds } from "../../providers/RoaringBroadcastStore";
import { viewSyncStore } from "../../providers/ViewSyncStore";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-white/5 px-4 py-2 text-xs">
      <span className="w-40 shrink-0 font-mono text-white/40">{label}</span>
      <span className="min-w-0 break-all font-mono text-white/80">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="sticky top-0 bg-[#0d0d14] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
        {title}
      </div>
      {children}
    </div>
  );
}

export function ScatterStatePlugin() {
  const brush = useStore(brushPredicateStore, (s) => s);
  const selection = useStore(selectionSyncStore, (s) => s);
  const view = useStore(viewSyncStore, (s) => s);

  return (
    <div className="h-full overflow-y-auto bg-[#0d0d14] text-white">
      <Section title="Brush Predicate Store">
        <Row label="version" value={brush.version} />
        <Row label="predicate" value={brush.predicate ?? <span className="text-white/20">null</span>} />
        <Row label="source" value={JSON.stringify(brush.source)} />
      </Section>

      <Section title="Selection Sync Store">
        <Row
          label="type"
          value={
            <span className={selection.type === "active" ? "text-purple-400" : "text-white/30"}>{selection.type}</span>
          }
        />
        {selection.type === "active" && (
          <>
            <Row label="sourcePanelId" value={selection.sourcePanelId} />
            <Row label="version" value={<span className="text-purple-400">{selection.version}</span>} />
            {(() => {
              const ids = getBitmapRowIds(selection.sourcePanelId);
              return (
                <>
                  <Row
                    label="bitmap.size"
                    value={<span className="text-purple-400">{ids.length.toLocaleString()}</span>}
                  />
                  <Row
                    label="bitmap[0..4]"
                    value={`[${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", …" : ""}]`}
                  />
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
            <span className={view.lockMode === "linked" ? "text-cyan-400" : "text-white/30"}>{view.lockMode}</span>
          }
        />
        <Row label="sourcePanelId" value={view.sourcePanelId ?? <span className="text-white/20">null</span>} />
        <Row label="panX" value={view.panX.toFixed(4)} />
        <Row label="panY" value={view.panY.toFixed(4)} />
        <Row label="zoom" value={view.zoom.toFixed(3)} />
      </Section>
    </div>
  );
}
