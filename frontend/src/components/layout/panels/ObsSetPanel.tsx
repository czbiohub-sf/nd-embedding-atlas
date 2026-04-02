/**
 * ObsSetPanel — lists saved ObsSets with activate toggle, drift badge, and delete.
 *
 * Uses TanStack Virtual for the list so large ObsSet collections render efficiently.
 */

import { useStore } from "@tanstack/react-store";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2 } from "lucide-react";
import { useRef } from "react";
import type { ObsSetId } from "../../../lib/branded-types";
import { obsSetId } from "../../../lib/branded-types";
import type { ObsSet } from "../../../lib/schemas";
import { cn } from "../../../lib/utils";
import { obsSetStore, setActiveObsSet } from "../../../stores/ObsSetStore";
import { useDeleteObsSet, useObsSets } from "../../scatter/useObsSets";

export function ObsSetPanel() {
  const { data: obssets = [], isLoading, isError } = useObsSets();
  const deleteObsSet = useDeleteObsSet();
  const activeObsSetId = useStore(obsSetStore, (s) => s.activeObsSetId);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: obssets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 5,
  });

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-text-secondary text-xs">Loading ObsSets…</div>;
  }

  if (isError) {
    return <div className="flex h-full items-center justify-center text-red-400 text-xs">Failed to load ObsSets</div>;
  }

  if (obssets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-text-secondary text-xs">
        <p>No ObsSets saved yet.</p>
        <p className="text-text-muted">Use the lasso tool to select observations, then click the bookmark icon.</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto px-2 py-2">
      <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
        {virtualizer.getVirtualItems().map((vitem) => {
          const obsset: ObsSet = obssets[vitem.index];
          const id = obsSetId(obsset.obsset_id);
          const isActive = activeObsSetId === id;
          const hasDrift = obsset.current_count < obsset.created_count;

          return (
            <div
              key={obsset.obsset_id}
              style={{
                position: "absolute",
                top: vitem.start,
                left: 0,
                right: 0,
                height: vitem.size,
              }}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                isActive ? "bg-primary/10" : "hover:bg-surface-secondary",
              )}
            >
              {/* Color swatch */}
              <div
                className="size-3 shrink-0 rounded-full border border-white/20"
                style={{ backgroundColor: obsset.color ?? "#6366f1" }}
              />

              {/* Name + count */}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-text-primary">{obsset.name}</p>
                <p className="text-text-muted">
                  {obsset.current_count.toLocaleString()} obs
                  {hasDrift && (
                    <span
                      className="ml-1 rounded bg-amber-500/20 px-1 text-amber-400"
                      title={`Created with ${obsset.created_count} obs; ${obsset.created_count - obsset.current_count} no longer present`}
                    >
                      drift
                    </span>
                  )}
                </p>
              </div>

              {/* Activate toggle */}
              <button
                type="button"
                onClick={() => setActiveObsSet(isActive ? null : (id as ObsSetId))}
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors",
                  isActive
                    ? "bg-primary text-white"
                    : "bg-surface-secondary text-text-secondary hover:bg-surface-tertiary",
                )}
                title={isActive ? "Deactivate filter" : "Activate as Mosaic filter"}
              >
                {isActive ? "Active" : "Activate"}
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={() => deleteObsSet.mutate(id as ObsSetId)}
                disabled={deleteObsSet.isPending}
                className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-secondary hover:text-red-400 disabled:opacity-40"
                title="Delete ObsSet"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
