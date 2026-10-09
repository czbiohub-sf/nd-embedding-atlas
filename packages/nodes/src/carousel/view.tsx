/**
 * Carousel node body: compare one subject across a variant axis, and label it.
 *
 * The focused obs is expanded into its PEER GROUP (see `use-group-peers`) and the
 * peers are laid out along the variant axis. For the regularizer sweep that is one
 * FOV at 25 strengths, side by side, in one spatial frame.
 *
 * Why crops and not N live viewers: idetik holds a WebGL2 context per instance and
 * exposes no dispose(), so 25 of them would exhaust the browser's context budget.
 * Peers of a group carry IDENTICAL x/y/z, so one shared view spec (z, half,
 * channels) renders every slide through `/api/crop` — the views are synchronized
 * structurally rather than by chasing camera events between live canvases. The
 * focused slide still escalates to the real thing: this node emits `focus`, so a
 * wired Image Viewer shows the selected variant with full interactivity.
 *
 * Labels go through `useAnnotationWriter`, the same write path the Annotate node
 * uses, so both surfaces stage into the same column and commit through one panel.
 */

import type { EmblaCarouselType } from "@ndea/ui/components/carousel";
import type { RowIndex } from "@ndea/sdk";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@ndea/ui/components/button";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@ndea/ui/components/carousel";
import { Input } from "@ndea/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { Slider } from "@ndea/ui/components/slider";
import { cn } from "@ndea/ui/lib/utils";
import { hotkeysFor } from "../annotate/label-hotkeys";
import { useAnnotationWriter } from "../annotate/use-annotation-writer";
import { useGalleryChannels } from "../gallery/useGalleryChannels";
import { type SweepWindowSlide, useSweepWindows } from "./use-sweep-windows";
import type { CarouselCapabilities, CarouselConfig, CarouselServices } from "./contracts";
import type { NodeBodyProps } from "../contracts";
import { useNodeFocus } from "../query/useNodeFocus";
import { useInputPredicateSql } from "../query/use-input-predicate";
import { focusVariant } from "./routing";
import { CarouselSlide } from "./CarouselSlide";
import { type SweepSlot, useSweepStage } from "./use-sweep-stage";
import { SweepScrollbar } from "./SweepScrollbar";
import {
  firstObsOfGroup,
  type GroupPeer,
  type GroupPeerFields,
  type GroupValue,
  useGroupCursor,
  useGroupPeers,
  useRowGroup,
} from "./use-group-peers";

/**
 * Drag arbitration between Embla and idetik.
 *
 * Both bind to the same gesture: Embla drags the track, and each live viewport's
 * PanZoomControls pans its camera. Unresolved, one drag did both — the image
 * panned while the strip slid out from under it.
 *
 * Rule: a drag STARTING on a live viewport belongs to that image; anywhere else
 * on the rail belongs to the strip. Returning false from `watchDrag` cancels
 * Embla's drag for that gesture only, leaving arrows, keyboard, card clicks and
 * the group stepper as navigation, and leaving crop-only slides swipeable.
 */
function carouselWatchDrag(_api: EmblaCarouselType, event: TouchEvent | MouseEvent): boolean {
  const target = event.target;
  return !(target instanceof Element && target.closest("[data-sweep-live]") != null);
}

/** Selectable on-screen variant counts. */
const PER_VIEW_CHOICES = [1, 2, 3, 4, 5] as const;
const DEFAULT_PER_VIEW = 3;

/** Keep a requested on-screen count inside the offered range. */
function clampPerView(value: number): number {
  return Math.min(Math.max(value, 1), PER_VIEW_CHOICES.at(-1) ?? DEFAULT_PER_VIEW);
}

/**
 * Extra live slides kept warm on each side of the visible run, so stepping one
 * variant does not stall on a cold zarr fetch. Every VISIBLE slide must be live
 * or there is nothing for the shared camera to move.
 */
const LIVE_MARGIN = 1;

function formatVariant(value: GroupValue | null): string {
  if (value == null) return "—";
  if (typeof value !== "number") return value;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function CarouselView({
  host,
  services,
}: NodeBodyProps<CarouselConfig, CarouselCapabilities> & { services: CarouselServices }) {
  const { coordinator } = host.data;
  // Session metadata arrives through the injected service, not the host: package
  // code must not reach into the app's dataset session directly.
  const { metadata } = services.dataset;
  const obsColumns = useMemo(() => (metadata.obs_columns ?? []).filter((c) => !c.startsWith("__")), [metadata]);

  const [groupByConfig, setGroupBy] = useState<string | null>(host.config.groupBy);
  const [variantByConfig, setVariantBy] = useState<string | null>(host.config.variantBy);

  // A preset names the sweep columns, but nothing guarantees THIS dataset has
  // them. Resolve both against the real schema so a mismatch opens the node on
  // its pickers instead of querying a column that does not exist.
  //
  // Fails CLOSED while the schema is unknown: firing SQL against unvalidated
  // names would surface as a DuckDB binder error that takes the whole sweep
  // down, and the pickers are empty in that state anyway, so there is nothing
  // to gain by guessing.
  const schemaReady = obsColumns.length > 0;
  const groupBy = schemaReady && groupByConfig != null && obsColumns.includes(groupByConfig) ? groupByConfig : null;
  const variantBy =
    schemaReady && variantByConfig != null && obsColumns.includes(variantByConfig) ? variantByConfig : null;
  const [column, setColumn] = useState<string | null>(host.config.column);
  const [creating, setCreating] = useState(false);
  const [newColumn, setNewColumn] = useState("");

  const labels = useMemo(
    () => (host.config.labels?.length ? host.config.labels : ["good", "bad"]),
    [host.config.labels],
  );
  const hotkeys = useMemo(() => hotkeysFor(labels), [labels]);

  const writer = useAnnotationWriter(host);
  const { busy, localLabels, stampRows, ensureColumn, columns, status } = writer;
  // A preset can point `column` at a name that does not exist yet: the first
  // label stamp creates it. Offer it in the picker meanwhile, or the trigger
  // renders blank and the configured target looks unset.
  const columnOptions = useMemo(
    () => (column && !columns.includes(column) ? [...columns, column] : columns),
    [columns, column],
  );

  const focusedRowIndex = useNodeFocus(host);
  // Reactive, not a render-time snapshot: the upstream scope mutates this
  // Selection in place, and the group cursor must re-query when it does.
  const predicate = useInputPredicateSql(host.inputPredicate);

  const fields = useMemo<GroupPeerFields>(
    () => ({
      fov: obsColumns.includes("fov_name") ? "fov_name" : null,
      t: obsColumns.includes("t") ? "t" : null,
      x: obsColumns.includes("x") ? "x" : null,
      y: obsColumns.includes("y") ? "y" : null,
      dataset: obsColumns.includes("_dataset") ? "_dataset" : null,
    }),
    [obsColumns],
  );

  // Only SELECT the label column once it actually exists. A preset seeds the
  // name before anything creates it, and reading an unregistered column fails
  // the binder and takes the whole sweep down with it. Writes still target
  // `column`: the first stamp creates it, and this flips to reading it.
  const readLabelColumn = column && columns.includes(column) ? column : null;
  const { groups } = useGroupCursor({ coordinator, groupBy, predicate });

  // Nothing focused yet is the NORMAL first frame: focus only exists after the
  // user clicks a row or a scatter point. Waiting for that left the node showing
  // an empty placeholder on load, which reads as "the carousel is broken".
  // Fall back to the first group in scope so the sweep is populated immediately.
  // Resolved locally and NOT published: publishing on mount would yank every
  // other view in the focus group to a row the user never chose.
  const [fallbackRow, setFallbackRow] = useState<RowIndex | null>(null);
  useEffect(() => {
    if (focusedRowIndex != null || groupBy == null || variantBy == null) return;
    const first = groups[0];
    if (first === undefined) return;
    let alive = true;
    void firstObsOfGroup(coordinator, groupBy, variantBy, first)
      .then((row) => {
        if (alive) setFallbackRow(row);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [focusedRowIndex, groupBy, variantBy, groups, coordinator]);

  const sweepRowIndex = focusedRowIndex ?? fallbackRow;
  // Two steps on purpose: the row → group lookup is keyed on the row, while the
  // peer expansion is keyed on the GROUP. That is what makes clicking a sibling
  // a pure selection change instead of a cache miss that rebuilds the track.
  const { groupValue } = useRowGroup({ coordinator, groupBy, rowIndex: sweepRowIndex });
  const { peers, loading } = useGroupPeers({
    coordinator,
    groupBy,
    variantBy,
    groupValue,
    labelColumn: readLabelColumn,
    fields,
  });

  // ── Shared view spec ────────────────────────────────────────────────
  // One (z, half, channels) drives every slide, which is what makes the sweep
  // comparable: the peers already share x/y, so the window is the same region.
  const channelSlot = peers[0]?.datasetKey ?? "docked";
  // The shared channel hook also reports the live viewer's Z, so both halves of
  // the view spec come from one injected source instead of a module-level store.
  const {
    channels: baseChannels,
    hash: baseHash,
    viewerZ,
  } = useGalleryChannels(channelSlot, 300, metadata.plate_channels, services.dataset);
  // Local mirror of the persisted choice, for the same reason `perView` is local:
  // `host.config` is a getter over a mutated object, so `patchConfig` alone would
  // leave the button showing its old state until the graph recooked.
  const [autoContrast, setAutoContrastState] = useState<boolean | null>(() => host.config.autoContrast ?? null);
  const setAutoContrast = useCallback(
    (next: boolean | null) => {
      setAutoContrastState(next);
      host.patchConfig({ autoContrast: next });
    },
    [host],
  );
  // A non-empty published slot means a live viewer set this window deliberately,
  // which is the default reason NOT to autocontrast.
  const publishedWindow = services.dataset.channels(channelSlot, 300, metadata.plate_channels).channels.length > 0;
  const autoOn = autoContrast ?? !publishedWindow;
  const [zOverride, setZOverride] = useState<number | null>(null);
  // Follow the live viewer's Z until the user takes manual control here.
  const z = zOverride ?? Math.round(viewerZ ?? 0);

  // How many variants share the strip. Every visible one is a live, camera-synced
  // idetik viewport, so this is also what sizes the live window below.
  //
  // Held in LOCAL state, not read back from config. `host.config` is a getter over
  // a mutated object, so `patchConfig` alone re-renders nothing: the new value only
  // became visible after the graph recooked and the document store pushed a new
  // subtree down. That made a pure layout change — how many cards fit — wait on
  // graph evaluation, which is why the toggle felt so slow. Config is still
  // written, just as a side effect rather than the source of truth.
  const [perView, setPerViewState] = useState(() => clampPerView(host.config.slidesPerView ?? DEFAULT_PER_VIEW));
  const setPerView = useCallback(
    (next: number) => {
      const value = clampPerView(next);
      setPerViewState(value);
      host.patchConfig({ slidesPerView: value });
    },
    [host],
  );

  // Which slide the sweep is centred on. Defined here because both the
  // virtualization window and the carousel wiring below depend on it.
  const activeIndex = useMemo(
    () => (sweepRowIndex == null ? -1 : peers.findIndex((p) => p.rowIndex === sweepRowIndex)),
    [peers, sweepRowIndex],
  );

  // ── Live idetik stage ───────────────────────────────────────────────
  // Virtualized on purpose: only slides inside the window get a viewport and
  // layers. 25 concurrent zarr streams over an SSH port-forward is the thing
  // this avoids; offscreen slides keep their cheap server-rendered crop.
  const [stageCanvas, setStageCanvas] = useState<HTMLCanvasElement | null>(null);
  const activeStore = metadata.plate_stores?.[0];
  const mountPrefix = activeStore?.mount ?? "/plate";
  const omeVersion = activeStore?.ome_version ?? metadata.plate_ome_version ?? "0.4";

  const liveSlots = useMemo<SweepSlot[]>(() => {
    if (peers.length === 0) return [];
    const centre = activeIndex >= 0 ? activeIndex : 0;
    // Embla centres the active slide, so the visible run straddles it. Cover the
    // whole run plus a margin: a visible-but-dead slide cannot be panned.
    const halfRun = Math.floor(perView / 2) + LIVE_MARGIN;
    const from = Math.max(0, centre - halfRun);
    const to = Math.min(peers.length - 1, centre + halfRun);
    const slots: SweepSlot[] = [];
    for (let index = from; index <= to; index++) {
      const peer = peers[index];
      if (!peer?.fovName) continue;
      slots.push({
        index,
        // Absolute: zarrita fetches chunks directly and bypasses the app's
        // fetch layer, so a relative URL would not resolve.
        sourceUrl: `${window.location.origin}${mountPrefix}/${peer.fovName}`,
        t: peer.t,
      });
    }
    return slots;
  }, [peers, activeIndex, mountPrefix, perView]);

  // One window per slide, derived from that slide's own pixel statistics. Keyed to
  // the virtualization window rather than the whole group: only slides that will
  // actually go live need stats, so a 25-variant sweep fetches ~5.
  const windowSlides = useMemo<SweepWindowSlide[]>(
    () =>
      liveSlots.map((slot) => ({
        index: slot.index,
        fovName: peers[slot.index]?.fovName ?? "",
        datasetKey: peers[slot.index]?.datasetKey,
      })),
    [liveSlots, peers],
  );
  const {
    bySlide: slideChannels,
    key: slideChannelKey,
    autoContrasted,
  } = useSweepWindows({
    base: baseChannels,
    baseHash,
    slides: windowSlides,
    enabled: autoOn,
  });

  const {
    bindSlide,
    liveIndices,
    resetView,
    zMax,
    blocked: stageBlocked,
    error: stageError,
  } = useSweepStage({
    canvas: stageCanvas,
    slots: liveSlots,
    channels: baseChannels,
    channelKey: baseHash,
    slideChannels,
    slideChannelKey,
    z,
    omeVersion,
    enabled: peers.length > 0,
  });

  // Stable per-index binder: an inline arrow would be a new ref callback every
  // render, detaching and re-adding every viewport on each keystroke.
  const bindersRef = useRef<Map<number, (element: HTMLElement | null) => void>>(new Map());
  const bindSlideAt = useCallback(
    (index: number) => {
      const existing = bindersRef.current.get(index);
      if (existing) return existing;
      const binder = (element: HTMLElement | null) => bindSlide(index, element);
      bindersRef.current.set(index, binder);
      return binder;
    },
    [bindSlide],
  );

  // ── Carousel ↔ focus, without a feedback loop ───────────────────────
  const [api, setApi] = useState<CarouselApi>();
  // Set when WE move the carousel, so the resulting "select" does not echo back
  // out as a focus publish and fight the incoming focus.
  const programmaticRef = useRef(false);

  useEffect(() => {
    if (!api || activeIndex < 0) return;
    if (api.selectedScrollSnap() === activeIndex) return;
    programmaticRef.current = true;
    api.scrollTo(activeIndex);
  }, [api, activeIndex]);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => {
      if (programmaticRef.current) {
        programmaticRef.current = false;
        return;
      }
      const peer = peers[api.selectedScrollSnap()];
      if (peer) focusVariant(host, peer.rowIndex);
    };
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api, peers, host]);

  // ── Actions ─────────────────────────────────────────────────────────
  const patch = useCallback(
    (next: Partial<CarouselConfig>) => {
      host.patchConfig(next);
    },
    [host],
  );

  const onLabel = useCallback(
    (peer: GroupPeer, value: string) => {
      if (!column) return;
      void stampRows(column, value, [peer.rowIndex]);
    },
    [column, stampRows],
  );

  const onFocusPeer = useCallback((peer: GroupPeer) => focusVariant(host, peer.rowIndex), [host]);

  const createColumn = useCallback(async () => {
    const name = newColumn.trim();
    if (!name) return;
    await ensureColumn(name);
    setColumn(name);
    setNewColumn("");
    setCreating(false);
    patch({ column: name });
  }, [newColumn, ensureColumn, patch]);

  const groupIndex = useMemo(
    () => (groupValue == null ? -1 : groups.findIndex((g) => g === groupValue)),
    [groups, groupValue],
  );

  const stepGroup = useCallback(
    async (delta: number) => {
      if (groupIndex < 0 || groupBy == null || variantBy == null) return;
      const next = groups[groupIndex + delta];
      if (next === undefined) return;
      const row = await firstObsOfGroup(coordinator, groupBy, variantBy, next);
      if (row != null) focusVariant(host, row);
    },
    [groupIndex, groups, groupBy, variantBy, coordinator, host],
  );

  // Hotkeys stamp the slide the carousel is on, so labeling never needs the mouse.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const index = hotkeys.indexOf(event.key.toLowerCase());
      if (index < 0) return;
      const peer = peers[api?.selectedScrollSnap() ?? activeIndex];
      if (!peer) return;
      event.preventDefault();
      onLabel(peer, labels[index]);
    },
    [hotkeys, peers, api, activeIndex, labels, onLabel],
  );

  const labelOf = useCallback(
    (peer: GroupPeer): string | null => {
      if (!column) return null;
      return localLabels.get(peer.rowIndex)?.get(column) ?? peer.label;
    },
    [column, localLabels],
  );

  const ready = groupBy != null && variantBy != null;
  const labelledCount = peers.reduce((n, p) => (labelOf(p) ? n + 1 : n), 0);

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the body is the
    // keyboard surface for label hotkeys; slides remain individually focusable.
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-1.5 outline-none" tabIndex={0} onKeyDown={onKeyDown}>
      {/* ── Toolbar: what defines a group, and what varies inside it ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <ColumnSelect
          label="group"
          value={groupBy}
          columns={obsColumns}
          onChange={(v) => {
            setGroupBy(v);
            patch({ groupBy: v });
          }}
        />
        <ColumnSelect
          label="across"
          value={variantBy}
          columns={obsColumns}
          onChange={(v) => {
            setVariantBy(v);
            patch({ variantBy: v });
          }}
        />

        <span className="text-2xs text-text-muted">label→</span>
        {creating ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={newColumn}
              placeholder="column name"
              className="h-7 w-32 text-2xs"
              onChange={(e) => setNewColumn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createColumn();
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <Button variant="outline" size="sm" className="h-7 px-2 text-2xs" onClick={() => void createColumn()}>
              add
            </Button>
          </div>
        ) : (
          <>
            <Select
              value={column ?? ""}
              onValueChange={(v) => {
                const next = typeof v === "string" && v ? v : null;
                setColumn(next);
                patch({ column: next });
              }}
            >
              <SelectTrigger className="h-7 w-32 text-2xs">
                <SelectValue placeholder="column" />
              </SelectTrigger>
              <SelectContent>
                {columnOptions.length === 0 ? (
                  <div className="px-2 py-1.5 text-2xs text-text-muted">no columns yet: create one →</div>
                ) : (
                  columnOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 px-2 text-2xs" onClick={() => setCreating(true)}>
              + new
            </Button>
          </>
        )}
      </div>

      {/* ── Shared view spec + group cursor ── */}
      <div className="flex shrink-0 items-center gap-2 text-2xs text-text-muted">
        {/* One Z for every slide: the peers are the same FOV, so a shared plane is
            what makes the comparison honest. Bounded by the opened stack's depth —
            the old steppers had no upper clamp and could run off the end. */}
        <span className="shrink-0">z</span>
        {/* Sized by a wrapper rather than a class on `Slider`: the component carries
            `data-horizontal:w-full`, which survives `cn` merging next to a plain
            `w-*` (different variant key), so the slider kept flexing to ~570px and
            squeezed the `show` group until it clipped its own last choices.
            This is also the element that yields first on a narrow tile. */}
        <div className="w-20 min-w-8 shrink">
          <Slider
            min={0}
            max={zMax ?? 0}
            step={1}
            disabled={zMax == null || zMax === 0}
            value={[Math.min(z, zMax ?? 0)]}
            onValueChange={(value) => setZOverride(Array.isArray(value) ? value[0] : value)}
            title="Z plane (all slides)"
          />
        </div>
        <span className="w-10 shrink-0 text-center tabular-nums text-foreground">
          {z}
          <span className="text-text-muted">{zMax != null ? `/${zMax}` : ""}</span>
        </span>
        {/* Hands Z back to the live viewer, which it follows until first drag. */}
        {zOverride != null ? (
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setZOverride(null)}
            title="follow the live viewer's Z again"
          >
            ↺
          </Button>
        ) : null}

        {/* Shared contrast: its own control, separate from the live viewer's
            per-channel autocontrast, because this one window governs every slide. */}
        <Button
          variant="outline"
          size="xs"
          className={cn("ml-2 h-5 px-1.5 text-3xs", autoOn && "border-primary/60 text-foreground")}
          // Reads the INTENT, falling back to the effective result: while the stats
          // request is in flight `autoContrasted` is still false, and a click then
          // would re-assert `true` instead of turning it off.
          onClick={() => setAutoContrast(!autoOn)}
          title={
            autoOn
              ? "shared auto-contrast on (from this sweep's pixel stats) — click for the published window"
              : "auto-contrast every slide from this sweep's own pixel stats"
          }
        >
          auto
        </Button>
        {/* Only offered once the choice is explicit, so the default stays invisible. */}
        {autoContrast != null ? (
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setAutoContrast(null)}
            title="follow the default (auto only when no viewer window is published)"
          >
            ↺
          </Button>
        ) : null}

        <span className="ml-2 shrink-0">show</span>
        {/* `shrink-0` is the real fix for the disappearing choices: the group clips
            its own content (`overflow-hidden` rounds the segmented border), so
            without it a squeezed row silently swallowed the last buttons instead of
            overflowing visibly. */}
        <div className="inline-flex h-5 shrink-0 overflow-hidden rounded-sm border border-input">
          {PER_VIEW_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={cn(
                "px-1.5 text-3xs tabular-nums transition-colors",
                choice !== PER_VIEW_CHOICES[0] && "border-input border-l",
                choice === perView ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-foreground",
              )}
              onClick={() => setPerView(choice)}
              title={`show ${choice} variant${choice === 1 ? "" : "s"} at once`}
            >
              {choice}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="xs"
          className="ml-2 h-5 px-1.5 text-3xs"
          onClick={resetView}
          title="re-frame every live slide on its full FOV"
        >
          fit
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-xs"
            disabled={groupIndex <= 0}
            onClick={() => void stepGroup(-1)}
            title="previous group in scope"
          >
            ◀
          </Button>
          <span className="tabular-nums">
            {groupIndex < 0 ? "—" : `${groupIndex + 1}/${groups.length}`}
            {groupValue != null ? ` · ${groupBy}=${formatVariant(groupValue)}` : ""}
          </span>
          <Button
            variant="outline"
            size="icon-xs"
            disabled={groupIndex < 0 || groupIndex >= groups.length - 1}
            onClick={() => void stepGroup(1)}
            title="next group in scope"
          >
            ▶
          </Button>
        </div>
      </div>

      {/* ── The sweep ── */}
      {/*
       * min-h is load-bearing, not cosmetic: in a short Stage tile the toolbars
       * and footer are shrink-0, so a bare `flex-1` collapsed this to height 0
       * and the stage canvas became 408x0 — three "live" viewports rendering
       * into nothing. Guarantee the sweep some vertical space.
       */}
      <div className="relative min-h-[176px] flex-1">
        {/*
         * ONE canvas for every live slide. It sits BEHIND the carousel track and
         * idetik scissors each viewport to its slide's element box, so N views
         * cost one WebGL2 context instead of N. pointer-events stay off: the
         * slide elements above own the gestures, and PanZoomControls is attached
         * per viewport to those elements.
         *
         * The horizontal inset MUST match the Carousel's own `px-8` gutter.
         * `CarouselContent` clips the track with `overflow-hidden`, but idetik
         * renders into this canvas, not the DOM, so that clip does not apply to
         * it. Left at the full width, the canvas overhung the clip by 32px each
         * side and a part-scrolled card was painted into the arrow gutter — the
         * grey bands bleeding off both ends of the strip. Matching the boxes
         * makes idetik's own intersection culling clip at the DOM boundary.
         *
         * The inset lives on a WRAPPER, not the canvas: `<canvas>` is a replaced
         * element with an intrinsic 300x150 size, so `left/right` insets alone
         * are over-constrained and the intrinsic width wins — the canvas
         * silently collapsed to 300x150. The wrapper stretches, the canvas fills it.
         */}
        <div className="pointer-events-none absolute inset-y-0 left-8 right-8">
          <canvas ref={setStageCanvas} className="h-full w-full" />
        </div>
        {!ready ? (
          <Placeholder text="pick a group column and a variant column to compare across" />
        ) : sweepRowIndex == null ? (
          <Placeholder text="resolving first group in scope…" />
        ) : loading ? (
          <Placeholder text="loading group…" />
        ) : peers.length === 0 ? (
          <Placeholder text="no peers found for this group" />
        ) : (
          <Carousel
            className="relative h-full px-8"
            opts={{ align: "center", containScroll: "trimSnaps", watchDrag: carouselWatchDrag }}
            setApi={setApi}
          >
            <CarouselContent>
              {peers.map((peer, index) => (
                <CarouselItem
                  key={peer.rowIndex}
                  // Inline flex-basis, not a `basis-*` class: the base component
                  // ships `basis-full`, and relying on class-merge order to beat
                  // it is how the strip silently ends up one slide wide.
                  style={{ flexBasis: `${100 / perView}%` }}
                >
                  <CarouselSlide
                    peer={peer}
                    variantLabel={formatVariant(peer.variant)}
                    label={labelOf(peer)}
                    labels={labels}
                    active={index === activeIndex}
                    busy={busy || !column}
                    live={liveIndices.has(index)}
                    bindStage={bindSlideAt(index)}
                    onLabel={onLabel}
                    onFocus={onFocusPeer}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="-left-1" />
            <CarouselNext className="-right-1" />
          </Carousel>
        )}
      </div>

      {/*
       * Position readout and scrub handle. Sits OUTSIDE the sweep container so it
       * is never overlapped by the shared idetik canvas, and outside the strip's
       * clip so it always spans the full body width.
       */}
      <SweepScrollbar api={api} slideCount={peers.length} />

      {/* ── Footer ── */}
      <div className="flex shrink-0 items-center gap-2 text-3xs text-text-muted">
        <span>
          {peers.length} variant{peers.length === 1 ? "" : "s"} · {labelledCount} labelled · {liveIndices.size} live
          {autoContrasted ? " · auto-contrast" : ""}
        </span>
        {stageBlocked ? (
          <span className="max-w-[280px] truncate text-warning" title={stageBlocked}>
            {stageBlocked}
          </span>
        ) : null}
        {stageError ? (
          <span className="max-w-[220px] truncate text-destructive" title={stageError}>
            stage: {stageError}
          </span>
        ) : null}
        {column ? (
          <span className="flex items-center gap-1">
            {labels.map((l, i) => (
              <span key={l} className="rounded-sm bg-muted px-1 py-px">
                {l} <span className="text-foreground">{hotkeys[i]}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-warning">pick a label column to start annotating</span>
        )}
        {status ? (
          <span
            className={cn(
              "ml-auto max-w-[240px] truncate",
              status.startsWith("✓") ? "text-success" : "text-destructive",
            )}
            title={status}
          >
            {status}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-2xs text-text-muted">{text}</div>;
}

function ColumnSelect({
  label,
  value,
  columns,
  onChange,
}: {
  label: string;
  value: string | null;
  columns: readonly string[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-2xs text-text-muted">{label}</span>
      <Select value={value ?? ""} onValueChange={(v) => onChange(typeof v === "string" && v ? v : null)}>
        <SelectTrigger className="h-7 w-28 text-2xs">
          <SelectValue placeholder="column" />
        </SelectTrigger>
        <SelectContent>
          {columns.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
