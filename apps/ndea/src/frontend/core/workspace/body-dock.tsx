/**
 * Body sockets: a view element's live body and header toolbar are stable DOM
 * elements owned by the runtime manager. A socket adopts them with
 * appendChild, so moving a tile (or going fullscreen) never remounts a body.
 */

import { useEffect, useSyncExternalStore } from "react";
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
        <div className="font-medium text-sm text-foreground">{label} failed</div>
        <div className="max-w-xs break-all font-mono text-muted-foreground text-xs">{state.error.message}</div>
        <button
          type="button"
          className="rounded border border-border px-3 py-1 text-muted-foreground text-xs hover:bg-muted"
          onClick={() => void runtime.retry()}
        >
          Retry
        </button>
      </div>
    ) : (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading {label}…</div>
    ),
    runtimes.bodyDock(id),
  );
}

export function HeaderSocket({ id }: { readonly id: string }) {
  const runtimes = useComponentRuntimes();
  return (
    <div
      className="flex min-w-0 flex-1 items-center"
      ref={(element) => {
        if (element) element.appendChild(runtimes.headerDock(id));
      }}
    />
  );
}

export function BodySocket({ id, className }: { readonly id: string; readonly className?: string }) {
  const runtimes = useComponentRuntimes();
  return (
    <div
      className={`relative ${className ?? "flex min-h-0 flex-1 flex-col overflow-hidden"}`}
      ref={(element) => {
        if (element) element.appendChild(runtimes.bodyDock(id));
      }}
    />
  );
}
