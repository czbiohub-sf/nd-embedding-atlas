/**
 * Body sockets: a view element's live body is a stable DOM element owned by
 * the runtime manager. A socket adopts it with appendChild, so moving a tile
 * (or going fullscreen) never remounts a body.
 *
 * Detaching a node drops the scroll offsets inside it without a scroll event,
 * and a virtualized list (the table, the gallery) then draws its rows where the
 * viewport no longer is: an empty body. So a socket adopts only when the body
 * is elsewhere, records the offsets as it lets go (before React removes it),
 * and restores them in the next socket.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useComponentRuntimes } from "@/core/component/runtime/runtime-context";

/** Starts the element's body (sticky) and shows its loading or failure state inside the dock. */
export function BodyStatus({ id, label }: { readonly id: string; readonly label: string }) {
  const runtimes = useComponentRuntimes();
  useEffect(() => void runtimes.activate(id), [runtimes, id]);
  const runtime = useSyncExternalStore(runtimes.subscribe, () => runtimes.get(id));
  const state = useSyncExternalStore(
    (listener) => runtime?.subscribe(listener) ?? (() => {}),
    () => runtime?.getSnapshot(),
  );
  if (!runtime || !state || state.status === "ready" || state.status === "disposed") return null;
  return createPortal(
    state.status === "failed" ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="font-medium text-lg text-foreground">{label} failed</div>
        <div className="max-w-xs break-all font-mono text-muted-foreground text-ui">{state.error.message}</div>
        <button
          type="button"
          className="rounded border border-border px-3 py-1 text-muted-foreground text-ui hover:bg-muted"
          onClick={() => void runtime.retry()}
        >
          Retry
        </button>
      </div>
    ) : (
      <div className="flex h-full items-center justify-center text-ui text-muted-foreground">Loading {label}…</div>
    ),
    runtimes.bodyDock(id),
  );
}

type Offsets = readonly (readonly [HTMLElement, number, number])[];

/** Offsets each dock had when its last socket let go. */
const held = new WeakMap<HTMLElement, Offsets>();

function scrolledWithin(dock: HTMLElement): Offsets {
  return [...dock.querySelectorAll<HTMLElement>("*")]
    .filter((e) => e.scrollTop > 0 || e.scrollLeft > 0)
    .map((e) => [e, e.scrollTop, e.scrollLeft] as const);
}

export function BodySocket({ id, className }: { readonly id: string; readonly className?: string }) {
  const runtimes = useComponentRuntimes();
  // Stable, so a re-render neither re-adopts nor re-records.
  const adopt = useCallback(
    (socket: HTMLDivElement | null) => {
      if (!socket) return;
      const dock = runtimes.bodyDock(id);
      if (dock.parentElement !== socket) {
        const offsets = dock.isConnected ? scrolledWithin(dock) : (held.get(dock) ?? []);
        socket.appendChild(dock);
        for (const [e, top, left] of offsets) {
          e.scrollTop = top;
          e.scrollLeft = left;
        }
      }
      return () => {
        if (dock.parentElement === socket) held.set(dock, scrolledWithin(dock));
      };
    },
    [runtimes, id],
  );
  return <div className={`relative ${className ?? "flex min-h-0 flex-1 flex-col overflow-hidden"}`} ref={adopt} />;
}
