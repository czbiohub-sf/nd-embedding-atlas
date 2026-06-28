/**
 * CollectionRowActions — kebab DropdownMenu + AlertDialog for a single row.
 *
 * Owns BOTH menu and dialog state internally (per refactoring-expert in PR2
 * stage 1: lifting per-row dialog state to the list adds nothing). The
 * AlertDialog renders via Portal so it survives the row's unmount when the
 * virtualizer scrolls it out of overscan during confirmation.
 *
 * Locally couples to `useScatterUIState` for the "Add current selection"
 * gating; that coupling is intentionally local so the parent CollectionsList
 * stays a pure view over Collection[].
 */

import { useState } from "react";
import { toast } from "sonner";
import { Download, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { ExportCollectionDialog } from "./ExportCollectionDialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { collectionId, type CollectionId } from "../../lib/branded-types";
import type { Collection } from "../../../protocol/index.ts";
import { useScatterUIState } from "@/nodes/scatter/ScatterUIStateProvider";
import { useAddMembers, useDeleteCollection } from "./useCollections";

export interface CollectionRowActionsProps {
  collection: Collection;
  /** Called when the user triggers Rename (via menu or F2). Parent owns rename state. */
  onRequestRename: (id: CollectionId) => void;
}

export function CollectionRowActions({ collection, onRequestRename }: CollectionRowActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const deleteCollection = useDeleteCollection();
  const addMembers = useAddMembers();
  const { selectedCount } = useScatterUIState();
  const id = collectionId(collection.collection_id);
  const hasLasso = (selectedCount ?? 0) > 0;

  function handleAddCurrent() {
    // Two-step: stage __scatter_selection then call append. Toast at call site.
    void (async () => {
      // The lasso lives on the scatter panel as a row-index list; the
      // bridge populates `__scatter_selection` whenever the user lassos
      // (see useScatterBrushSync). We just hit the append endpoint with
      // `from_scatter_selection: true`.
      try {
        const env = await addMembers.mutateAsync({ id, body: { from_scatter_selection: true } });
        const { added, already_member } = env.stats;
        if (added === 0 && already_member > 0) {
          toast.info(`No new members · ${already_member.toLocaleString()} already in collection`);
        } else {
          toast.success(
            `Added ${added.toLocaleString()} · ${collection.name}${already_member > 0 ? ` (${already_member.toLocaleString()} already in collection)` : ""}`,
          );
        }
      } catch (err) {
        toast.error(`Add failed · ${err instanceof Error ? err.message : "unknown"}`);
      }
    })();
  }

  function handleConfirmDelete() {
    deleteCollection.mutate(id, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success(`Deleted · ${collection.name}`);
      },
      onError: (err) => toast.error(`Delete failed · ${err instanceof Error ? err.message : "unknown"}`),
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Actions for ${collection.name}`}
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => onRequestRename(id)}>
            <Pencil />
            <span>Rename</span>
            <DropdownMenuShortcut>F2</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasLasso || addMembers.isPending}
            onClick={hasLasso ? handleAddCurrent : undefined}
          >
            <Plus />
            <span>Add current selection</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setExportOpen(true)}>
            <Download />
            <span>Export…</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            // Keep menu state stable while AlertDialog opens — the menu's
            // default click-handler would otherwise close before the
            // dialog mounts and steals focus from us.
            onClick={(e) => {
              e.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <Trash2 />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ExportCollectionDialog collection={collection} open={exportOpen} onOpenChange={setExportOpen} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{" "}
              <span className="inline-block max-w-[24ch] truncate align-bottom font-mono">{collection.name}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {collection.current_count.toLocaleString()} member
              {collection.current_count === 1 ? "" : "s"} will be removed. ID:{" "}
              <span className="font-mono">#{collection.collection_id.slice(0, 4)}</span>. Soft delete — restorable from
              the sidecar file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteCollection.isPending}>
              Delete collection
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
