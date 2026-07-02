/**
 * Node extras — Houdini flag affordances + the ◇ Selection and Collection
 * node bodies + the scatter's lasso/freeze footer.
 *
 * Flags: bypass (transforms/subnets) wears hazard stripes, a struck label
 * and a periwinkle pass-through jumper; display-off (views) dims and
 * desaturates with a `display off · not cooking` badge — body and tile
 * alike. Both read on the LED (idle).
 */

import { IterationCw, Link2 } from "lucide-react";
import { useState } from "react";

import { NdIconButton } from "@/components/nd/nd-icon-button";
import { NdBracketed, NdCaption, NdChip, NdHud } from "@/components/nd/nd-primitives";
import { useCollections } from "@/components/collections/useCollections";
import { ScopePicker } from "./scope-picker";
import { NODE_DEFS } from "../node-defs";
import type { FeedbackChannel } from "../feedback";
import { nodeConfig, patchConfig } from "../node-kit";
import { useNodeCount } from "../use-node-count";
import { useTelemetrySelector, useWorkspace, useWsSelector } from "../workspace-context";
import type { WsNode } from "../types";

/* ── feedback channel badges (wireless ↻ pair, no backward wire) ──────── */

const FEEDBACK_COLOR = "var(--color-wire-feedback)";

/** De-duped, comma-joined labels for a set of feedback channels. */
const fbNames = (chans: FeedbackChannel[], pick: (c: FeedbackChannel) => string) =>
  [...new Set(chans.map(pick))].join(", ");

/**
 * The wireless-channel badge pair. A node that WRITES data wears a filled ↻
 * (emitter); the SOURCE its data re-enters wears a dashed ↻ (receiver). Same
 * glyph + color = "these are the two ends of one loop" — instead of a backward
 * wire that would cross the whole canvas. (Hover-to-trace ghost path is a
 * follow-up; this is the always-on indicator.)
 */
export function FeedbackBadges({ nodeId, channels }: { nodeId: string; channels: readonly FeedbackChannel[] }) {
  const emits = channels.filter((c) => c.from === nodeId);
  const recvs = channels.filter((c) => c.to === nodeId);
  if (emits.length === 0 && recvs.length === 0) return null;
  return (
    <>
      {emits.length > 0 ? (
        <span
          data-nodrag="1"
          title={`feedback → re-enters ${fbNames(emits, (c) => c.toLabel)} (writes a column back into the source data)`}
          className="absolute z-[8] inline-flex items-center rounded-full px-[3px] py-[2px]"
          style={{ right: -7, bottom: -9, background: FEEDBACK_COLOR, color: "#06201d" }}
        >
          <IterationCw size={11} strokeWidth={2.4} />
        </span>
      ) : null}
      {recvs.length > 0 ? (
        <span
          data-nodrag="1"
          title={`feedback ← ${fbNames(recvs, (c) => c.fromLabel)} writes a column that re-enters this source`}
          className="absolute z-[8] inline-flex items-center rounded-full border bg-card px-[3px] py-[2px]"
          style={{ left: -7, bottom: -9, borderColor: FEEDBACK_COLOR, color: FEEDBACK_COLOR }}
        >
          <IterationCw size={11} strokeWidth={2.4} />
        </span>
      ) : null}
    </>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");

/* ── flag button (header) ────────────────────────────────────────── */

export function FlagButton({ node, compact = false }: { node: WsNode; compact?: boolean }) {
  const ws = useWorkspace();
  const flags = useWsSelector((s) => s.flags[node.id] ?? {});
  const def = NODE_DEFS[node.type];
  if ((def.kind === "transform" || def.kind === "subnet") && node.type !== "selection") {
    return (
      <NdIconButton
        icon="bypass"
        tone={flags.bypass ? "amber" : "default"}
        compact={compact}
        title={
          flags.bypass
            ? "bypassed — input passes through uncooked · click to restore (b)"
            : "bypass — pass input through uncooked (b)"
        }
        onClick={() => ws.toggleFlag(node.id, "bypass")}
      />
    );
  }
  if (def.kind === "view" && def.pluginId) {
    return (
      <NdIconButton
        icon="power"
        tone={flags.off ? "amber" : "default"}
        compact={compact}
        title={flags.off ? "display off — branch never cooks · click to wake (d)" : "display off — park this view (d)"}
        onClick={() => ws.toggleFlag(node.id, "off")}
      />
    );
  }
  return null;
}

/* ── flag overlays (frame-level) ─────────────────────────────────── */

export function BypassOverlay({ chip }: { chip: boolean }) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-[7]"
        style={{
          borderRadius: chip ? 999 : 7,
          background: "repeating-linear-gradient(45deg, rgba(245, 158, 11, 0.14) 0 7px, transparent 7px 15px)",
        }}
      />
      {/* the pass-through jumper: in-port → out-port */}
      <div
        className="pointer-events-none absolute z-[7] h-0.5 rounded-sm"
        style={{
          left: -6,
          right: -6,
          top: 12,
          background: "var(--color-wire-pred)",
          boxShadow: "0 0 7px rgba(139, 123, 247, 0.9)",
        }}
      />
    </>
  );
}

export function DisplayOffBadge() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[26px] bottom-0 z-[7] grid place-items-center">
      <NdHud size={8.5} className="rounded border border-dashed border-border-active bg-card px-2 py-[3px]">
        display off · not cooking
      </NdHud>
    </div>
  );
}

/* ── dataset source body — pick which `_dataset` this stream carries ── */
export function DatasetSourceBody({ node }: { node: WsNode }) {
  const ws = useWorkspace();
  const keys = ws.deps.metadata.dataset_keys ?? [];
  const datasetKey = nodeConfig<{ datasetKey?: string | null }>(node).datasetKey ?? "";
  if (keys.length <= 1) {
    return <div className="font-mono text-3xs text-text-muted">single dataset · no _dataset split</div>;
  }
  return (
    <div className="flex flex-col gap-[7px]" data-nodrag="1">
      <span className="font-mono text-3xs text-text-muted">_dataset</span>
      <select
        value={datasetKey}
        onChange={(e) => ws.setDatasetKey(node.id, e.target.value || undefined)}
        title={datasetKey || "all datasets"}
        className="nodrag w-full truncate rounded border border-border bg-muted px-1.5 py-1 font-mono text-3xs text-foreground"
      >
        <option value="">all datasets</option>
        {keys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── ◆ Cache node body — source-agnostic, live-until-cached checkpoint ─ */

export function CacheNodeBody({ node }: { node: WsNode }) {
  const ws = useWorkspace();
  // emissions / cooks bump the epoch → re-read live input + recompute stale.
  const epoch = useTelemetrySelector((t) => t.epoch);

  const cached = ws.isCached(node.id);
  // cached + the live input has moved past the pin → recache available (R5).
  const stale = cached && node.stamp !== undefined && epoch > node.stamp;
  const live = ws.liveCacheInput(node.id);
  const liveCount = live?.kind === "sel" ? (live.rowIds?.length ?? null) : null;
  // Pinnable when there's a sql predicate OR a row set (a rowset-only sel, e.g.
  // a large lasso staged server-side, is materialized into an IN-list on pin).
  const hasLive = !!live?.sql || (live?.kind === "sel" && (live.rowIds?.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-[7px]" data-nodrag="1">
      {/* state line — live vs cached, unambiguous (R9) */}
      {cached ? (
        <div className="font-mono text-3xs text-muted-foreground">
          ◆ cached <span className="text-text-muted">@ epoch {String(node.stamp ?? 0).padStart(4, "0")}</span>
        </div>
      ) : (
        <div className="font-mono text-3xs text-wire-sel">
          ○ live {liveCount !== null ? <NdBracketed>{fmt(liveCount)}</NdBracketed> : null}
          <span className="ml-1 text-text-muted">passes input through</span>
        </div>
      )}

      {/* Cache / Recache action + stale flag */}
      {stale ? (
        <div className="flex items-center gap-1.5 rounded border border-wire-sel/40 bg-wire-sel/10 px-1.5 py-[3px]">
          <span className="font-mono text-[9px] text-wire-sel">⚠ stale — input @ {String(epoch).padStart(4, "0")}</span>
          <NdIconButton
            icon="freeze"
            label="recache"
            tone="amber"
            title="re-pin to the current live input"
            className="ml-auto"
            onClick={() => ws.pinCache(node.id)}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <NdIconButton
            icon="freeze"
            label={cached ? "recache" : "cache"}
            tone="amber"
            title={cached ? "re-pin to the current live input" : "pin the current rows by value"}
            onClick={() => ws.pinCache(node.id)}
          />
          {cached ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                ws.uncache(node.id);
              }}
              className="cursor-pointer rounded border border-border bg-muted px-1.5 py-[3px] font-mono text-[9px] text-text-muted"
            >
              go live
            </button>
          ) : (
            <span className="font-mono text-[8.5px] text-text-muted">{hasLive ? "ready to pin" : "no input"}</span>
          )}
        </div>
      )}

      <NdCaption className="text-[9px]">
        {cached
          ? "pinned row-set — output is a stable predicate (push → pull converts here)"
          : "live — output follows the input until you cache it"}
      </NdCaption>
    </div>
  );
}

/* ── Export sink node body ────────────────────────────────────────── */

/** Save the wired input's rows as a server collection. Decoupled from Cache:
 *  reads the live input directly (no pinning). Only a row-bearing input (a
 *  lasso/cache snapshot) is saveable — a pred-only input has no row ids. */
export function ExportNodeBody({ node }: { node: WsNode }) {
  const ws = useWorkspace();
  useTelemetrySelector((t) => t.epoch); // emissions bump the epoch → re-read input
  const [name, setName] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const live = ws.liveCacheInput(node.id);
  const rowCount = live?.kind === "sel" ? (live.rowIds?.length ?? null) : null;
  const saveable = rowCount !== null && rowCount > 0;

  const save = async () => {
    if (!name.trim()) return;
    setSaveState("saving");
    const res = await ws.saveAsCollection(node.id, name.trim());
    if (res.ok) setSaveState("saved");
    else {
      setSaveState("error");
      setSaveError(res.error ?? "save failed");
    }
  };

  const saved = nodeConfig<{ collectionId?: string | null; collectionName?: string | null }>(node);
  if (saved.collectionId) {
    return (
      <div className="flex flex-col gap-[7px]" data-nodrag="1">
        <div className="flex items-center gap-1.5">
          <NdChip tone="amber">◆ {saved.collectionName}</NdChip>
          <span className="font-mono text-[8.5px] text-text-muted">saved</span>
        </div>
        <NdCaption className="text-[9px]">saved to collections — re-name + save again to fork</NdCaption>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[7px]" data-nodrag="1">
      <div className="font-mono text-3xs text-wire-sel">
        ↓ export {rowCount !== null ? <NdBracketed>{fmt(rowCount)}</NdBracketed> : null}
        <span className="ml-1 text-text-muted">{saveable ? "rows ready" : "wire a row selection"}</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="collection name"
          className="h-[18px] min-w-0 flex-1 rounded border border-border bg-muted px-1.5 font-mono text-[9.5px] text-foreground placeholder:text-text-muted"
        />
        <NdIconButton
          icon="freeze"
          label={saveState === "saving" ? "…" : "save"}
          tone="amber"
          title="save the wired row-set as a collection"
          onClick={() => void save()}
        />
      </div>
      {saveState === "error" && saveError ? (
        <span className="font-mono text-[8.5px] text-destructive">{saveError}</span>
      ) : null}
      <NdCaption className="text-[9px]">saves the wired rows as a server collection</NdCaption>
    </div>
  );
}

/* ── Collection source node body (C12) ───────────────────────────── */

export function CollectionNodeBody({ node }: { node: WsNode }) {
  const ws = useWorkspace();
  const { data: collections, isLoading } = useCollections();

  const bound = nodeConfig<{ collectionId?: string | null; collectionName?: string | null }>(node);
  if (bound.collectionId) {
    return (
      <div className="flex flex-col gap-[7px]" data-nodrag="1">
        <div className="flex items-center gap-1.5">
          <NdChip tone="amber">{bound.collectionName}</NdChip>
        </div>
        <NdCaption className="text-[9px]">emits the collection's members as a stable predicate</NdCaption>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            ws.store.setState((s) => ({
              ...s,
              nodes: {
                ...s.nodes,
                [node.id]: {
                  ...s.nodes[node.id],
                  config: patchConfig(s.nodes[node.id], { collectionId: null, collectionName: null }),
                },
              },
            }));
            ws.collectionBindings.delete(node.id);
            ws.engine.markDirty(node.id);
          }}
          className="self-start cursor-pointer rounded border border-border bg-muted px-1.5 py-[3px] font-mono text-[9px] text-text-muted"
        >
          unbind
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-1 overflow-y-auto" data-nodrag="1">
      <NdHud size={8.5}>pick a collection</NdHud>
      {isLoading ? <span className="font-mono text-[9px] text-text-muted">loading…</span> : null}
      {collections?.length === 0 ? (
        <NdCaption className="text-[9px]">no collections yet — freeze a lasso and save it</NdCaption>
      ) : null}
      {collections?.map((c) => (
        <button
          type="button"
          key={c.collection_id}
          onClick={(e) => {
            e.stopPropagation();
            ws.bindCollection(node.id, { id: c.collection_id, name: c.name, version: c.version });
          }}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-[3px] text-left font-mono text-[9.5px] text-muted-foreground hover:bg-surface-tertiary"
        >
          <span
            className="size-[7px] shrink-0 rounded-full"
            style={{ background: c.color ?? "var(--color-wire-sel)" }}
          />
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          <NdBracketed>{fmt(c.current_count)}</NdBracketed>
        </button>
      ))}
    </div>
  );
}

/* ── coordination: multi-chip badge + per-type scope picker (U4) ──────── */

/** Always-on indicator of every coordination scope a node is on — one colored
 *  chip per active TYPE (focus / view sync / sort). Bottom-center so it doesn't
 *  collide with the feedback corner badges. */
export function SyncBadge({ nodeId }: { nodeId: string }) {
  const ws = useWorkspace();
  const scopes = useWsSelector((s) => s.coordinationScopes[nodeId] ?? null);
  const entries = scopes ? Object.entries(scopes) : [];
  if (entries.length === 0) return null;
  return (
    <span
      data-nodrag="1"
      className="absolute z-[8] inline-flex items-center gap-[3px]"
      style={{ bottom: -9, left: "50%", transform: "translateX(-50%)" }}
    >
      {entries.map(([type, scope]) => (
        <span
          key={type}
          title={`${type} scope ${scope} — peers share ${type}`}
          className="inline-flex items-center gap-[2px] rounded-full px-[5px] py-[2px] text-[8px] font-bold"
          style={{ background: ws.coordination.scopeColor(scope), color: "#0c0c12" }}
        >
          <Link2 size={9} strokeWidth={2.6} />
          {scope}
        </span>
      ))}
    </span>
  );
}

/** Header link affordance — the per-type scope picker (U4). */
export function SyncGroupButton({ nodeId }: { nodeId: string }) {
  return <ScopePicker nodeId={nodeId} />;
}

/* ── scatter lasso footer (full form) + tile actions ─────────────── */

export function ScatterLassoActions({ nodeId, compactLabel = false }: { nodeId: string; compactLabel?: boolean }) {
  const ws = useWorkspace();
  useTelemetrySelector((t) => t.epoch); // emissions bump the epoch → re-read
  const live = ws.getLasso(nodeId);
  const count = live?.rowIds?.length ?? null;
  if (!live?.sql) return null;
  return (
    <span className="inline-flex items-center gap-1.5" data-nodrag="1">
      <span className="font-mono text-[9px] whitespace-nowrap text-wire-sel">
        lasso {count !== null ? <NdBracketed>{fmt(count)}</NdBracketed> : null}
      </span>
      <NdIconButton
        icon="freeze"
        label={compactLabel ? undefined : "cache"}
        tone="amber"
        title="cache as ◆ Cache node (pins the current lasso rows)"
        onClick={() => ws.freezeSelection(nodeId)}
      />
    </span>
  );
}

/* ── subnet + count bodies (built-in node specs) ──────────────────── */

/** subnet card: inner-node count + enter affordance (double-click also enters) */
export function SubnetBody({ node }: { node: WsNode }) {
  const ws = useWorkspace();
  const inner = useWsSelector(
    (s) => Object.values(s.nodes).filter((n) => n.parent === node.id && n.type !== "proxy").length,
  );
  return (
    <div className="flex flex-col gap-[7px]">
      <span className="font-mono text-3xs text-muted-foreground">{inner} inner · own wiring level</span>
      <span data-nodrag="1" className="inline-flex">
        <NdIconButton
          icon="enter"
          label="enter"
          title="enter subnet (double-click)"
          onClick={() => ws.enterSubnet(node.id)}
        />
      </span>
    </div>
  );
}

/** big-number body for the Count node */
export function CountBody({ node }: { node: WsNode }) {
  const { count, cooking, error } = useNodeCount(node.id, true);
  return (
    <span
      className={`font-mono text-[22px] font-semibold tabular-nums${error ? " text-destructive" : ""}`}
      title={error ?? undefined}
    >
      {error ? "✗" : cooking || count === null ? "…" : fmt(count)}
    </span>
  );
}
