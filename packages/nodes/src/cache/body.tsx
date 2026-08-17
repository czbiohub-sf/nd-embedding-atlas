import { useSyncExternalStore } from "react";
import type { NodeHost } from "@ndea/sdk";
import { Bracketed } from "@ndea/ui/components/bracketed";
import type { CacheCapabilities, CacheCheckpointResolver, CacheIconButton } from "./contracts";

const formatCount = (count: number) => count.toLocaleString("en-US");

export function createCacheBody(getCheckpoint: CacheCheckpointResolver, IconButton: CacheIconButton) {
  return function CacheBody({ host }: { host: NodeHost<unknown, CacheCapabilities> }) {
    const checkpoint = getCheckpoint(host);
    const snapshot = useSyncExternalStore(checkpoint.subscribe, checkpoint.getSnapshot, checkpoint.getSnapshot);
    const { epoch, pinned, pinnedEpoch, input } = snapshot;
    const stale = pinned && pinnedEpoch !== null && epoch > pinnedEpoch;
    const rowCount = input?.kind === "row-set" ? input.rowCount : null;
    const hasInput = input !== null;

    return (
      <div className="flex flex-col gap-[7px]" data-nodrag="1">
        {pinned ? (
          <div className="font-mono text-3xs text-muted-foreground">
            ◆ cached <span className="text-text-muted">@ epoch {String(pinnedEpoch ?? 0).padStart(4, "0")}</span>
          </div>
        ) : (
          <div className="font-mono text-3xs text-wire-sel">
            ○ live {rowCount !== null ? <Bracketed>{formatCount(rowCount)}</Bracketed> : null}
            <span className="ml-1 text-text-muted">passes input through</span>
          </div>
        )}

        {stale ? (
          <div className="flex items-center gap-1.5 rounded border border-wire-sel/40 bg-wire-sel/10 px-1.5 py-[3px]">
            <span className="font-mono text-[9px] text-wire-sel">
              ⚠ stale: input @ {String(epoch).padStart(4, "0")}
            </span>
            <IconButton
              icon="freeze"
              label="recache"
              tone="amber"
              title="re-pin to the current live input"
              className="ml-auto"
              onClick={() => {
                if (!snapshot.pending) void checkpoint.pin();
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <IconButton
              icon="freeze"
              label={pinned ? "recache" : "cache"}
              tone="amber"
              title={pinned ? "re-pin to the current live input" : "pin the current rows by value"}
              onClick={() => {
                if (!snapshot.pending) void checkpoint.pin();
              }}
            />
            {pinned ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  checkpoint.unpin();
                }}
                className="cursor-pointer rounded border border-border bg-muted px-1.5 py-[3px] font-mono text-[9px] text-text-muted"
              >
                go live
              </button>
            ) : (
              <span className="font-mono text-[8.5px] text-text-muted">{hasInput ? "ready to pin" : "no input"}</span>
            )}
          </div>
        )}

        {snapshot.error ? <div className="font-mono text-[9px] text-danger">{snapshot.error}</div> : null}

        <div className="font-sans text-[10.5px] leading-normal text-text-muted">
          {pinned
            ? "pinned row-set: output is a stable predicate (push → pull converts here)"
            : "live: output follows the input until you cache it"}
        </div>
      </div>
    );
  };
}
