/**
 * CollectionRow — single row within the virtualized CollectionsList.
 *
 * Editing state is LIFTED to the parent (`editingId` / `editingName` in
 * CollectionsList) so that:
 *   1. only one row is editable at a time (single-edit invariant)
 *   2. when the virtualizer remounts the row mid-edit (scroll out of
 *      overscan), the draft text survives via parent state
 *
 * Caret position resets to end on remount — accepted as a degraded path
 * for v1 (realistic users have <20 collections; scroll-during-rename is
 * a stress test). v1.1 may pin the editing row outside virtualization if
 * a real bug filters in.
 */

import { useEffect, useRef } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { Collection } from "../../../protocol/index.ts";
import { collectionId, type CollectionId } from "../../lib/branded-types";
import { hasDrift, hasSyntheticIdentity } from "../../lib/collections-helpers";
import { cn } from "../../lib/utils";
import { CollectionBadges } from "./CollectionBadges";
import { CollectionRowActions } from "./CollectionRowActions";

export interface CollectionRowProps {
  collection: Collection;
  isActive: boolean;
  /** Lifted: id of the row currently being renamed (null when no row is). */
  editingId: CollectionId | null;
  /** Lifted: draft text for the editing row. */
  editingName: string;
  onActivateToggle: (id: CollectionId) => void;
  onRequestRename: (id: CollectionId) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onEditingNameChange: (next: string) => void;
}

export function CollectionRow({
  collection: c,
  isActive,
  editingId,
  editingName,
  onActivateToggle,
  onRequestRename,
  onCommitRename,
  onCancelRename,
  onEditingNameChange,
}: CollectionRowProps) {
  const id = collectionId(c.collection_id);
  const isEditing = editingId === id;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    // Focus + select-all on mount or remount (the virtualizer may unmount
    // and remount during scroll). The select-all is the "fresh edit"
    // contract; caret position is lost on remount in v1.
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [isEditing]);

  const driftDelta = hasDrift(c) ? c.created_count - c.current_count : undefined;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
        isActive ? "bg-primary/15 ring-1 ring-primary/40 ring-inset hover:bg-primary/20" : "hover:bg-surface-secondary",
      )}
    >
      <div
        className="size-3 shrink-0 rounded-full border border-white/20"
        style={{ backgroundColor: c.color ?? "var(--muted-foreground)" }}
      />

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="flex flex-col gap-0.5">
            <Input
              ref={inputRef}
              value={editingName}
              onChange={(e) => onEditingNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCommitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelRename();
                }
              }}
              onBlur={onCommitRename}
              className="h-6 px-1.5 text-xs"
              aria-label={`Rename ${c.name}`}
            />
            <span className="flex items-center gap-2 text-3xs text-muted-foreground">
              <KbdGroup>
                <Kbd>↵</Kbd> save
              </KbdGroup>
              <KbdGroup>
                <Kbd>Esc</Kbd> cancel
              </KbdGroup>
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onRequestRename(id)}
              onKeyDown={(e) => {
                if (e.key === "F2") {
                  e.preventDefault();
                  onRequestRename(id);
                }
              }}
              className="block w-full truncate text-left font-medium text-text-primary hover:underline"
              title="Click or press F2 to rename"
            >
              {c.name}
            </button>
            <div className="text-text-muted">
              <span className="mr-1.5">{c.current_count.toLocaleString()} obs</span>
              <CollectionBadges
                tags={c.tags}
                hasDrift={hasDrift(c)}
                driftDelta={driftDelta}
                hasSyntheticIdentity={hasSyntheticIdentity(c.provenance)}
                className="inline-flex"
              />
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => onActivateToggle(id)}
        className={cn(
          "shrink-0 rounded p-1 transition-colors",
          isActive ? "text-primary" : "text-text-muted hover:bg-surface-secondary hover:text-text-primary",
        )}
        title={isActive ? "Deactivate filter (show all)" : "Filter dataset to this collection"}
        aria-pressed={isActive}
      >
        {isActive ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      </button>

      <CollectionRowActions collection={c} onRequestRename={onRequestRename} />
    </div>
  );
}
