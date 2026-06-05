/**
 * CollectionsList — virtualized list of saved collections inside the Sheet.
 *
 * Owns:
 *   - search query (case- + diacritic-insensitive substring on name+tags)
 *   - lifted editing state (single-edit invariant; survives row remounts
 *     during virtualizer scroll, with caret-loss as a documented degraded
 *     path for v1)
 *   - global Esc handler (commits any active rename)
 *
 * Per-row delegates to <CollectionRow>; per-row actions to <CollectionRowActions>.
 * Toasts at call sites (rename success/failure here; delete + add-current
 * inside CollectionRowActions).
 */

import { useSelector } from "@tanstack/react-store";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import type { Collection } from "../../../protocol/index.ts";
import { collectionId, type CollectionId } from "../../lib/branded-types";
import { filterCollections } from "../../lib/collections-helpers";
import { activeCollectionStore, setActiveCollection } from "../../stores/ActiveCollectionStore";
import { CollectionRow } from "./CollectionRow";
import { useCollections, usePatchCollection } from "./useCollections";

export function CollectionsList() {
  const { data: collections = [], isLoading, isError, error } = useCollections();
  const patchCollection = usePatchCollection();
  const activeId = useSelector(activeCollectionStore, (s) => s.activeId);
  const parentRef = useRef<HTMLDivElement>(null);

  // Search state — client-side filter; cheap on realistic N (<200 rows).
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterCollections(collections, query), [collections, query]);

  // Lifted editing state — single-edit invariant + survives row remount.
  const [editingId, setEditingId] = useState<CollectionId | null>(null);
  const [editingName, setEditingName] = useState("");
  // Snapshot the version at edit-start so optimistic concurrency works
  // even if the list refetches while editing.
  const editingVersionRef = useRef(0);
  const editingOriginalRef = useRef("");

  const requestRename = (id: CollectionId) => {
    const target = collections.find((c) => c.collection_id === id);
    if (!target) return;
    setEditingId(id);
    setEditingName(target.name);
    editingVersionRef.current = target.version;
    editingOriginalRef.current = target.name;
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingName("");
  };

  const commitRename = () => {
    if (!editingId) return;
    const next = editingName.trim();
    // Empty / unchanged → silent cancel (no PATCH, no toast).
    if (next.length === 0 || next === editingOriginalRef.current) {
      cancelRename();
      return;
    }
    patchCollection.mutate(
      { id: editingId, body: { name: next, version: editingVersionRef.current } },
      {
        onSuccess: () => {
          toast.success(`Renamed · ${next}`);
          cancelRename();
        },
        onError: (err) => {
          toast.error(`Rename failed · ${err instanceof Error ? err.message : "unknown"}`);
        },
      },
    );
  };

  // Global Esc commits/cancels any in-flight edit so it doesn't leak past
  // the sheet close. Captures Esc before the sheet's own handler if focus
  // is inside the input — input's local Esc fires first; this only catches
  // edge cases where blur dropped without commit.
  useEffect(() => {
    if (!editingId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRename();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingId]);

  // Virtualizer over the filtered list (NOT raw collections) so the count
  // tracks search results.
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 5,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary text-xs">Loading collections…</div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-red-400 text-xs">
        <p>Failed to load collections</p>
        <p className="text-3xs text-text-muted">{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-text-secondary text-xs">
        <p>No collections saved yet.</p>
        <p className="text-text-muted">Use the lasso, then click the bookmark icon to save a selection.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border-subtle border-b px-2 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or tag…"
            className="h-6 pr-7 pl-7 text-xs"
            aria-label="Search collections"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-surface-secondary hover:text-text-primary"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-text-secondary text-xs">
          <p>No collections match "{query}".</p>
        </div>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
            {virtualizer.getVirtualItems().map((vitem) => {
              const c: Collection = filtered[vitem.index];
              const id = collectionId(c.collection_id);
              return (
                <div
                  key={c.collection_id}
                  style={{
                    position: "absolute",
                    top: vitem.start,
                    left: 0,
                    right: 0,
                    height: vitem.size,
                  }}
                >
                  <CollectionRow
                    collection={c}
                    isActive={activeId === id}
                    editingId={editingId}
                    editingName={editingName}
                    onActivateToggle={(rid) => setActiveCollection(activeId === rid ? null : rid)}
                    onRequestRename={requestRename}
                    onCommitRename={commitRename}
                    onCancelRename={cancelRename}
                    onEditingNameChange={setEditingName}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
