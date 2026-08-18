/**
 * The sweep stage: N live idetik views of N different FOVs, on ONE WebGL2 context.
 *
 * The naive reading of "an idetik viewer per carousel card" is one `Idetik` per
 * card, which does not work: each instance takes its own `getContext("webgl2")`,
 * the browser caps those near 16, and the class exposes no `dispose()` (the
 * `dispose()` in the type surface belongs to `ChunkStoreView`), so sliding would
 * leak contexts until the oldest died.
 *
 * idetik's actual multi-view primitive is the VIEWPORT. One instance owns one
 * canvas, one `ChunkManager`, and any number of viewports, each with its own
 * camera, controls, and layer stack. Three properties of the renderer make this
 * fit a carousel exactly:
 *
 *  - `render()` calls `viewport.getBoxRelativeTo(canvas)` EVERY FRAME and derives
 *    the GL scissor/viewport from it. Rects are never cached, so a viewport bound
 *    to an element inside Embla's translating track tracks it for free.
 *  - `render()` skips a viewport whose element computes to
 *    `visibility: hidden`, and intersection-culls viewports outside the canvas.
 *  - Viewports are added and removed dynamically at no context cost.
 *
 * So virtualization is just membership: only slides inside the window get a
 * viewport and layers, which is what bounds zarr streaming over a port-forward.
 * One `ChunkManager` also means eviction is coordinated across every slide rather
 * than N caches competing.
 *
 * Camera sync is normalized, not world-space. Each FOV carries its own
 * `coordinateTransformations.translation`, so copying a world rect between slides
 * would aim slide B's camera at slide A's plate position and show empty space.
 * Instead one shared {cx, cy, halfW} in FOV-relative units is applied through each
 * slide's own bounds, which is what makes "the same region of a different
 * reconstruction" meaningful.
 */

import type { Idetik as IdetikRuntime, ImageLayer, Overlay } from "@idetik/core";
import { Idetik, OrthographicCamera, PanZoomControls } from "@idetik/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChannelDef } from "../gallery/contracts";
import {
  buildSlideLayers,
  channelStyles,
  loadOmero,
  openSlideSource,
  type SlideBounds,
  type SweepSlideSource,
} from "./sweep-slide-source";
import { fullView, sameView, type SharedView, viewToWorldFrame, worldRectToView } from "./sweep-view";

/**
 * idetik declares `Viewport` but does not export it, and its private members make
 * it nominal, so a structural stand-in is not assignable back to
 * `removeViewport`. Deriving it from the factory is the only available handle.
 */
type SweepViewport = ReturnType<IdetikRuntime["addViewport"]>;

/** One slide the stage should render live. */
export interface SweepSlot {
  /** Index within the full peer list; stable identity for this slide. */
  index: number;
  /** Absolute OME-Zarr root URL for this FOV. */
  sourceUrl: string;
  /** Timepoint for this obs. */
  t: number;
}

interface SlotState {
  sourceUrl: string;
  element: HTMLElement;
  bounds: SlideBounds;
  camera: OrthographicCamera;
  viewport: SweepViewport;
  layers: ImageLayer[];
  /** Kept so a channel-window change can be restyled in place, without a rebuild. */
  source: SweepSlideSource["source"];
  omero: Awaited<ReturnType<typeof loadOmero>>;
}

export interface UseSweepStageOptions {
  canvas: HTMLCanvasElement | null;
  /** The virtualization window, in carousel order. */
  slots: readonly SweepSlot[];
  /** Fallback channel styling for any slide without its own window. */
  channels: readonly ChannelDef[];
  /** Identity of `channels`, so contrast edits restyle exactly once. */
  channelKey: string;
  /**
   * Per-slide windows, keyed by slot index; a slide with no entry uses
   * `channels`. Autocontrast is per slide because the sweep's intensity scale
   * varies by orders of magnitude across the variant axis — see
   * `use-sweep-windows`.
   */
  slideChannels?: ReadonlyMap<number, readonly ChannelDef[]>;
  /** Identity of `slideChannels`, so a resolved window restyles exactly once. */
  slideChannelKey?: string;
  /** Shared Z plane. Read through a live getter, so moving it never rebuilds. */
  z: number;
  omeVersion: "0.4" | "0.5";
  enabled: boolean;
}

export interface SweepStageController {
  /** Bind (or release, with null) the element a slide index renders into. */
  bindSlide: (index: number, element: HTMLElement | null) => void;
  /** Slides whose layers are attached and drawing. */
  liveIndices: ReadonlySet<number>;
  /** Reset every slide back to its full FOV. */
  resetView: () => void;
  /**
   * Z planes available in the stack, or null before the first slide resolves.
   * Read from the opened OME-Zarr rather than fetched separately.
   */
  zMax: number | null;
  /**
   * Why live rendering is unavailable, or null when it is running. Surfaced so a
   * crops-only fallback is never silent.
   */
  blocked: string | null;
  error: string | null;
}

/** Apply a shared FOV-relative view to one camera using that slide's own bounds. */
function applyView(camera: OrthographicCamera, bounds: SlideBounds, view: SharedView): void {
  // idetik 0.36 takes a NAMED frame, which removes the old footgun where
  // `setFrame` was positional (left, right, bottom, top) while the constructor
  // was (left, right, top, bottom) — transposing them silently flipped the image.
  // `WorldFrame` already carries exactly these four fields.
  camera.setFrame(viewToWorldFrame(bounds, view));
}

/** Read a camera's current rect back into shared FOV-relative units. */
function readView(camera: OrthographicCamera, bounds: SlideBounds): SharedView {
  return worldRectToView(bounds, camera.getWorldViewRect().toRect());
}

export function useSweepStage({
  canvas,
  slots,
  channels,
  channelKey,
  slideChannels,
  slideChannelKey = "",
  z,
  omeVersion,
  enabled,
}: UseSweepStageOptions): SweepStageController {
  const runtimeRef = useRef<IdetikRuntime | null>(null);
  const slotsRef = useRef<Map<number, SlotState>>(new Map());
  const elementsRef = useRef<Map<number, HTMLElement>>(new Map());
  // Null until the first slide resolves: zoom is carried in world units now, so
  // there is no meaningful default before a FOV's extent is known.
  const viewRef = useRef<SharedView | null>(null);
  // Last view observed per slide, so real motion is distinguishable from the
  // per-card aspect correction idetik bakes into every camera.
  const lastViewsRef = useRef<Map<number, SharedView>>(new Map());
  const [liveIndices, setLiveIndices] = useState<ReadonlySet<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [zMax, setZMax] = useState<number | null>(null);
  const [bindEpoch, setBindEpoch] = useState(0);

  // idetik sizes its framebuffer from `canvas.clientWidth` (LAYOUT pixels) but
  // computes every viewport's scissor box from `getBoundingClientRect()` (VISUAL
  // pixels). Those agree only while no ancestor is scaled.
  //
  // Inside React Flow's `__viewport` — `transform: matrix(0.249, …)` at default
  // zoom — a 686px-wide canvas gets a 686px buffer while every viewport box is
  // computed in the 0–171 range, so all of them collapse into one corner: the
  // first card half-draws and the rest never render at all.
  //
  // The mismatch is internal to the renderer, so it cannot be corrected from
  // out here. Refuse to run and let the caller fall back to crops.
  const [unscaled, setUnscaled] = useState(true);
  useEffect(() => {
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const ok = canvas.clientWidth > 0 && Math.abs(rect.width / canvas.clientWidth - 1) < 0.02;
      setUnscaled((prev) => (prev === ok ? prev : ok));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    // The scale lives on an ANCESTOR, so panning or zooming the graph changes it
    // without ever resizing our canvas. Poll cheaply to notice.
    const timer = window.setInterval(measure, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [canvas]);

  const active = enabled && unscaled;

  // Live getters: Z and T reach the GPU without rebuilding a layer.
  const zRef = useRef(z);
  zRef.current = z;

  const bindSlide = useCallback((index: number, element: HTMLElement | null) => {
    const current = elementsRef.current.get(index);
    if (element === current) return;
    if (element) elementsRef.current.set(index, element);
    else elementsRef.current.delete(index);
    // Elements arrive during commit; reconciliation runs in an effect.
    setBindEpoch((n) => n + 1);
  }, []);

  // ── Runtime: one instance, created once per canvas ──
  useEffect(() => {
    if (!canvas || !active) return;
    // The maps are mutated, never reassigned, so capturing them here gives the
    // cleanup a stable handle instead of reading a ref during teardown.
    const liveSlots = slotsRef.current;
    const liveViews = lastViewsRef.current;
    const runtime = new Idetik({ canvas, viewports: [] });
    runtimeRef.current = runtime;
    runtime.start();

    // Per-frame sync, gesture-agnostic and aspect-safe.
    //
    // Two earlier attempts failed for instructive reasons:
    //  1. Nominating a "driving" card on pointerdown silently excluded
    //     WHEEL-ZOOM, the primary gesture here, so nothing ever synced.
    //  2. Comparing each camera against the shared view looked right but
    //     deadlocked: `Viewport`'s constructor calls `updateAspectRatio()`,
    //     which rewrites the camera frame, so a card never equals the shared
    //     value exactly. The first card therefore read as "moved" on EVERY
    //     frame and its view was re-imposed on the others, cancelling whatever
    //     the user had just done to a different card.
    //
    // So compare each camera against ITS OWN previous frame. Aspect correction
    // is stable per card, so it cancels out, and only real motion registers.
    // Followers store the view read back AFTER applying, which is aspect-
    // corrected for their own box and therefore not mistaken for motion next
    // frame.
    const overlay: Overlay = {
      update() {
        const live = slotsRef.current;
        const previous = lastViewsRef.current;
        let moverIndex: number | null = null;
        let moverView: SharedView | null = null;

        for (const [index, slot] of live) {
          const current = readView(slot.camera, slot.bounds);
          const prior = previous.get(index);
          if (prior === undefined) {
            previous.set(index, current);
            continue;
          }
          if (!sameView(current, prior)) {
            moverIndex = index;
            moverView = current;
            break;
          }
        }
        if (moverIndex == null || moverView == null) return;

        viewRef.current = moverView;
        previous.set(moverIndex, moverView);
        for (const [index, slot] of live) {
          if (index === moverIndex) continue;
          applyView(slot.camera, slot.bounds, moverView);
          previous.set(index, readView(slot.camera, slot.bounds));
        }
      },
    };
    runtime.addOverlay(overlay);

    return () => {
      runtime.removeOverlay(overlay);
      for (const slot of liveSlots.values()) {
        slot.viewport.removeAllLayers();
        runtime.removeViewport(slot.viewport);
      }
      liveSlots.clear();
      liveViews.clear();
      setLiveIndices(new Set());
      // idetik exposes no dispose(); stop() ends the rAF loop and detaches its
      // observers. The context is released when the canvas is collected.
      runtime.stop();
      runtimeRef.current = null;
    };
  }, [canvas, active]);

  // ── Reconcile the window: add missing slides, drop departed ones ──
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !active) return;
    let cancelled = false;

    const wanted = new Map(slots.map((s) => [s.index, s]));

    // Drop slides that left the window, or whose FOV changed underneath them.
    // Collected first, then removed: mutating the map mid-iteration is how you
    // silently skip an entry.
    const stale: number[] = [];
    for (const [index, slot] of slotsRef.current) {
      const want = wanted.get(index);
      if (want && want.sourceUrl === slot.sourceUrl && elementsRef.current.get(index) === slot.element) continue;
      stale.push(index);
    }
    for (const index of stale) {
      const slot = slotsRef.current.get(index);
      if (!slot) continue;
      slot.viewport.removeAllLayers();
      runtime.removeViewport(slot.viewport);
      slotsRef.current.delete(index);
      lastViewsRef.current.delete(index);
    }

    const add = async () => {
      for (const slot of slots) {
        if (cancelled) return;
        if (slotsRef.current.has(slot.index)) continue;
        const element = elementsRef.current.get(slot.index);
        if (!element) continue;

        const opened = await openSlideSource(slot.sourceUrl, omeVersion);
        if (cancelled) return;
        // Re-check: the window may have moved while metadata was in flight.
        if (!elementsRef.current.has(slot.index) || slotsRef.current.has(slot.index)) continue;

        const omero = await loadOmero(opened.source);
        if (cancelled) return;
        if (!elementsRef.current.has(slot.index) || slotsRef.current.has(slot.index)) continue;

        // Construct on this FOV's own extent, then immediately adopt the sweep's
        // current view so a slide entering the window matches its neighbours.
        // The first slide has no shared view yet and keeps its full extent.
        const initial = viewRef.current ?? fullView(opened.bounds);
        const camera = new OrthographicCamera(viewToWorldFrame(opened.bounds, initial));

        // Its own window when one has resolved, else the shared baseline.
        const layers = buildSlideLayers(opened.source, slideChannels?.get(slot.index) ?? channels, omero, {
          t: () => slot.t,
          z: () => zRef.current,
        });
        const viewport = runtime.addViewport({
          id: `sweep-${slot.index}`,
          element,
          camera,
          cameraControls: new PanZoomControls(camera),
          layers,
        });

        slotsRef.current.set(slot.index, {
          sourceUrl: slot.sourceUrl,
          element,
          bounds: opened.bounds,
          camera,
          viewport,
          layers,
          source: opened.source,
          omero,
        });
        // Record the camera's post-aspect-correction state so the very next
        // overlay frame does not read this setup as user motion.
        lastViewsRef.current.set(slot.index, readView(camera, opened.bounds));
        // Depth of the stack, so the shared Z control can be bounded. Every peer
        // is the same FOV under a different regularizer, so the first slide to
        // resolve speaks for the sweep.
        setZMax((prev) => prev ?? opened.bounds.zMax);
        setLiveIndices(new Set(slotsRef.current.keys()));
      }
    };

    setLiveIndices(new Set(slotsRef.current.keys()));
    void add().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
    };
  }, [slots, channels, channelKey, slideChannels, omeVersion, active, bindEpoch]);

  // ── Push a changed channel window into slides that are ALREADY live ──
  //
  // `sliceCoords` is getter-backed, so t/z are re-read every frame and the shared
  // Z control works on live cards for free. `channelProps` is NOT: it is a
  // snapshot taken when the layer was constructed. And the reconcile effect above
  // deliberately skips any slot it already has, so a contrast change reached only
  // slides that mounted afterwards — toggling auto-contrast appeared to do nothing
  // to the cards already on screen.
  //
  // `setChannelProps` restyles in place: no layer rebuild, no viewport churn, and
  // no refetch, since the chunks are unchanged and only their colour mapping moves.
  useEffect(() => {
    for (const [index, slot] of slotsRef.current) {
      const styles = channelStyles(slot.source, slideChannels?.get(index) ?? channels, slot.omero);
      for (const layer of slot.layers) layer.setChannelProps(styles);
    }
    // The two keys identify the windows' contents; the maps are the payload.
  }, [channels, channelKey, slideChannels, slideChannelKey, liveIndices]);

  const resetView = useCallback(() => {
    // Re-frame each slide on its OWN full extent. There is no single shared
    // "full" any more: zoom lives in world units, which differ per FOV.
    viewRef.current = null;
    for (const slot of slotsRef.current.values()) applyView(slot.camera, slot.bounds, fullView(slot.bounds));
    // Re-seed from the cameras' actual (aspect-corrected) state, or the next
    // frame reads this deliberate reset as user motion and fights it.
    for (const [index, slot] of slotsRef.current) {
      lastViewsRef.current.set(index, readView(slot.camera, slot.bounds));
    }
  }, []);

  return {
    bindSlide,
    liveIndices,
    resetView,
    zMax,
    blocked: unscaled ? null : "live view needs the Stage (the node canvas is zoomed)",
    error,
  };
}
