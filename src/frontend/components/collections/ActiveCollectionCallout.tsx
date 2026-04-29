/**
 * ActiveCollectionCallout — top-left overlay shown while a collection is
 * the active scope.
 *
 * Subscribes directly to `activeCollectionStore` + the collections list
 * query. Mounts inside DashboardShell as a fixed-positioned sibling of the
 * panel surface — NOT inside ScatterView (would re-render every pan/zoom)
 * or inside the panel chrome (would clip on overflow). Single instance for
 * the whole app: even with multiple scatter panels open, there's only one
 * "active collection" globally.
 */

import { useSelector } from "@tanstack/react-store";
import { X } from "lucide-react";
import { activeCollectionStore, setActiveCollection } from "../../stores/ActiveCollectionStore";
import { useCollections } from "./useCollections";

export function ActiveCollectionCallout() {
  const activeId = useSelector(activeCollectionStore, (s) => s.activeId);
  const { data: collections = [] } = useCollections();

  if (!activeId) return null;
  const c = collections.find((x) => x.collection_id === activeId);
  if (!c) return null; // collection deleted while active — wait for store to clear

  return (
    <div
      className="pointer-events-auto absolute top-3 left-3 z-30 flex items-center gap-2 rounded-md border border-primary/40 bg-popover/85 px-3 py-1.5 shadow-lg backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <span
        className="size-2.5 shrink-0 rounded-full border border-white/20"
        style={{ backgroundColor: c.color ?? "var(--muted-foreground)" }}
        aria-hidden
      />
      <span className="font-medium text-foreground text-xs">{c.name}</span>
      <span className="text-muted-foreground text-[10px] tabular-nums">{c.current_count.toLocaleString()} obs</span>
      <button
        type="button"
        onClick={() => setActiveCollection(null)}
        className="ml-1 rounded p-0.5 text-primary transition-colors hover:bg-primary/15"
        title="Deactivate (Esc)"
        aria-label="Deactivate collection"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
