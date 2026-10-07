import { useState, useSyncExternalStore } from "react";
import type { NodeHost } from "@ndea/sdk";
import { Bracketed } from "@ndea/ui/components/bracketed";
import type { CacheCapabilities, CacheConfig, CacheIconButton } from "./contracts";

const formatCount = (count: number) => count.toLocaleString("en-US");

export function createCacheBody(IconButton: CacheIconButton) {
  return function CacheBody({ host }: { host: NodeHost<CacheConfig, CacheCapabilities> }) {
    const [pin, setPin] = useState(host.config.pin);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const livePredicate = useSyncExternalStore(
      host.filter.subscribeResolved,
      () => host.filter.getResolved().predicate,
    );

    // Freeze the live rows (graph input AND filter scope) as an observation set in the config.
    const cache = async () => {
      if (pending) return;
      setPending(true);
      setError(null);
      try {
        const { rowIds } = await host.filter.materializeRowIds(host.signal);
        const { set, count } = await host.dataAPI.createObservationSet(rowIds);
        const next = { clause: { op: "inSet", set }, count } as const;
        host.patchConfig({ pin: next });
        setPin(next);
      } catch (cause) {
        if (!host.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!host.signal.aborted) setPending(false);
      }
    };

    const goLive = () => {
      host.patchConfig({ pin: null });
      setPin(null);
    };

    return (
      <div className="flex flex-col gap-[7px]" data-nodrag="1">
        {pin ? (
          <div className="font-mono text-3xs text-muted-foreground">
            ◆ cached <Bracketed>{formatCount(pin.count)}</Bracketed>
          </div>
        ) : (
          <div className="font-mono text-3xs text-wire-sel">
            ○ live <span className="ml-1 text-text-muted">passes its filtered input through</span>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <IconButton
            icon="freeze"
            label={pin ? "recache" : "cache"}
            tone="amber"
            title={pin ? "re-pin to the current live input" : "pin the current rows by value"}
            onClick={() => void cache()}
          />
          {pin ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                goLive();
              }}
              className="cursor-pointer rounded border border-border bg-muted px-1.5 py-[3px] font-mono text-[9px] text-text-muted"
            >
              go live
            </button>
          ) : (
            <span className="font-mono text-[8.5px] text-text-muted">
              {pending ? "caching…" : livePredicate === null ? "all rows" : "ready to pin"}
            </span>
          )}
        </div>

        {error ? <div className="font-mono text-[9px] text-danger">{error}</div> : null}

        <div className="font-sans text-[10.5px] leading-normal text-text-muted">
          {pin
            ? "pinned: output is this observation set, saved in the workspace"
            : "live: output follows the input and filter scope until you cache it"}
        </div>
      </div>
    );
  };
}
