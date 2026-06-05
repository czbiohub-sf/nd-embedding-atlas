/**
 * SaveCollectionSection — collapsible "Save current selection" region at the
 * top of the unified CollectionsSheet. Hidden when no selection is active;
 * collapsed-by-default when opened via Mod+B; auto-expanded when the user
 * clicks the bookmark trigger.
 */

import { Bookmark, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SaveCollectionForm } from "./SaveCollectionForm";

interface Props {
  getRowIndices: () => readonly number[];
  selectionCount: number;
  /** When true, section starts expanded. Used by the bookmark trigger. */
  autoExpand: boolean;
  /** Called once after the section consumes the autoExpand signal. */
  onAutoExpandConsumed: () => void;
}

export function SaveCollectionSection({ getRowIndices, selectionCount, autoExpand, onAutoExpandConsumed }: Props) {
  const [expanded, setExpanded] = useState(autoExpand);

  // When the trigger fires `autoExpand=true`, sync local state and
  // immediately reset the provider flag so subsequent re-mounts of the
  // sheet don't auto-expand on stale state.
  useEffect(() => {
    if (autoExpand) {
      setExpanded(true);
      onAutoExpandConsumed();
    }
  }, [autoExpand, onAutoExpandConsumed]);

  return (
    <div className="border-border border-b">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs transition-colors",
          "hover:bg-muted/40",
          expanded && "bg-muted/30",
        )}
        aria-expanded={expanded}
      >
        <Bookmark className="size-3.5 shrink-0 text-primary" />
        <span className="flex-1 truncate">
          Save <span className="font-medium tabular-nums">{selectionCount.toLocaleString()}</span> obs as new
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <SaveCollectionForm
          getRowIndices={getRowIndices}
          selectionCount={selectionCount}
          onSaved={() => setExpanded(false)}
          onCancel={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
