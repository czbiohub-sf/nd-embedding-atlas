/**
 * Headless per-slide OME-Zarr loading for the sweep stage.
 *
 * `useFovLoader` does the same job but is bound to one ViewerProvider context: it
 * writes bounds through `useViewer()` actions and reads t/z from that provider's
 * refs. The carousel needs N independent FOVs inside ONE idetik runtime, so the
 * loading half is lifted out here as a plain async function with no React and no
 * context — the caller supplies live t/z getters and owns the returned layers.
 *
 * 2D only, deliberately. A VolumeLayer per slide would ray-march N stacks at once
 * for a comparison that is inherently a single-plane judgement.
 */

import { Color, createPlaybackPolicy, ImageLayer, loadOmeroChannels, OmeZarrImageSource } from "@idetik/core";
import { resolveContrastWindow, safeContrastLimits } from "../image-viewer/contrast-window";
import type { ChannelDef } from "../gallery/contracts";

/** Minimal shape of the loader exposed by `OmeZarrImageSource.loader`. */
interface IdetikLoader {
  getSourceDimensionMap(): {
    x: { lods: { size: number; scale?: number; translation?: number }[] };
    y: { lods: { size: number; scale?: number; translation?: number }[] };
    z?: { lods: { size: number }[] };
    t?: { lods: { size: number }[] };
  };
}

/** Where this FOV sits in world space, and how deep its stack is. */
export interface SlideBounds {
  zMax: number | null;
  tMax: number | null;
  /** World-space origin from OME coordinateTransformations; HCS plates offset each FOV. */
  translation: { x: number; y: number };
  /** World units per pixel. */
  scale: { x: number; y: number };
  /** Extent in world units. */
  size: { width: number; height: number };
}

export interface SweepSlideSource {
  source: OmeZarrImageSource;
  bounds: SlideBounds;
}

/** Live per-frame coordinate getters, so moving Z never rebuilds a layer. */
export interface SliceGetters {
  t: () => number;
  z: () => number;
}

/**
 * Coarsest level the sweep is allowed to escalate to.
 *
 * These reconstructions are written with ONE chunk per pyramid level covering the
 * whole Z stack — there is no spatial chunking, so a level cannot be partially
 * fetched and every visible pixel costs the entire level. Measured on the autoreg
 * plate (2048², 12 planes, float32):
 *
 *   L0 168.6 MB · L1 42.4 MB · L2 10.7 MB · L3 2.7 MB · L4 0.7 MB
 *
 * A card-sized viewport naturally selects L3/L4, so a five-slide window costs a
 * few MB. Letting it reach L0 would cost ~840 MB across that window, which is
 * unusable over an SSH port-forward. Flooring at L2 bounds the worst case to
 * ~10.7 MB per slide while still resolving far more detail than a card shows.
 *
 * Full-resolution inspection is deliberately NOT this node's job: the carousel
 * emits focus, and the wired Image Viewer opens the chosen variant alone at L0.
 *
 * One upside of the same chunking: Z costs nothing once a slide is loaded, since
 * every plane already arrived inside the chunk. The shared Z slider is free.
 */
export const SWEEP_LOD_FLOOR = 2;

// Keyed by source URL. Sized for the virtualization window rather than the
// image-viewer's LRU-5: the sweep keeps a handful of neighbouring FOVs warm so
// stepping back one slide does not re-fetch zarr metadata.
const SOURCE_CACHE = new Map<string, SweepSlideSource>();
const SOURCE_CACHE_MAX = 16;

/**
 * Open a FOV's OME-Zarr root and read its world placement. Cached per URL, so a
 * slide re-entering the window is metadata-free.
 */
export async function openSlideSource(url: string, omeVersion: "0.4" | "0.5"): Promise<SweepSlideSource> {
  const hit = SOURCE_CACHE.get(url);
  if (hit) return hit;

  const source = await OmeZarrImageSource.fromHttp({ url, version: omeVersion });
  const loader = source.loader as unknown as IdetikLoader;
  const dims = loader.getSourceDimensionMap();
  const x = dims.x.lods[0];
  const y = dims.y.lods[0];
  const scale = { x: x.scale ?? 1, y: y.scale ?? 1 };
  const opened: SweepSlideSource = {
    source,
    bounds: {
      zMax: dims.z ? dims.z.lods[0].size - 1 : null,
      tMax: dims.t ? dims.t.lods[0].size - 1 : null,
      translation: { x: x.translation ?? 0, y: y.translation ?? 0 },
      scale,
      size: { width: x.size * scale.x, height: y.size * scale.y },
    },
  };

  if (SOURCE_CACHE.size >= SOURCE_CACHE_MAX) {
    const oldest = SOURCE_CACHE.keys().next().value;
    if (oldest !== undefined) SOURCE_CACHE.delete(oldest);
  }
  SOURCE_CACHE.set(url, opened);
  return opened;
}

/**
 * Per-channel colour and contrast for a slide.
 *
 * The caller decides which window a slide gets: autocontrast resolves one per
 * slide from its own pixel statistics, because a regularization sweep varies
 * intensity scale by orders of magnitude across the axis (see
 * `use-sweep-windows`). Whatever ChannelDefs arrive here win; omero metadata is
 * only a fallback for when none were resolved.
 */
export function channelStyles(
  source: OmeZarrImageSource,
  shared: readonly ChannelDef[],
  omero: Awaited<ReturnType<typeof loadOmeroChannels>> | null,
): { color: Color; contrastLimits: [number, number] }[] {
  if (shared.length > 0) {
    return shared.map((ch) => ({
      color: Color.fromRgbHex(`#${ch.color}`),
      contrastLimits: safeContrastLimits(ch.contrastLimits),
    }));
  }
  if (omero) {
    return omero.map((ch) => ({
      color: ch.color ? Color.fromRgbHex(`#${ch.color}`) : Color.WHITE,
      contrastLimits: safeContrastLimits(resolveContrastWindow(ch.window)),
    }));
  }
  return Array.from({ length: source.getChannelCount() }, () => ({
    color: Color.WHITE,
    contrastLimits: [0, 65535] as [number, number],
  }));
}

/**
 * Build this slide's 2D layers: one ImageLayer per channel, selected with
 * `c: [i]`.
 *
 * `channelProps` carries the FULL per-channel array on every layer even though
 * each renders one slot — idetik ≥0.23 validates
 * `channelProps.length === source.channelCount` regardless of `sliceCoords.c`.
 *
 * Channel 0 uses "normal" rather than the default "none": "none" disables GPU
 * blending, which makes layer opacity a no-op and would silently break
 * visibility toggling. Over a cleared black framebuffer at full opacity the two
 * are pixel-identical.
 */
export function buildSlideLayers(
  source: OmeZarrImageSource,
  shared: readonly ChannelDef[],
  omero: Awaited<ReturnType<typeof loadOmeroChannels>> | null,
  slice: SliceGetters,
  lodMin: number = SWEEP_LOD_FLOOR,
): ImageLayer[] {
  // Bandwidth is bounded by the ZERO prefetch windows and by SWEEP_LOD_FLOOR,
  // NOT by trimming priorityOrder: idetik validates that the order lists all
  // five categories exactly once and throws otherwise, which silently took every
  // slide's layers down and fell the whole sweep back to crops.
  const policy = createPlaybackPolicy({
    prefetch: { x: 0, y: 0, z: 0, t: 0 },
    lod: { min: lodMin, bias: 0.5 },
    priorityOrder: ["visibleCurrent", "fallbackVisible", "prefetchTime", "prefetchSpace", "fallbackBackground"],
  });
  const styles = channelStyles(source, shared, omero);

  return styles.map((_style, index) => {
    const sliceCoords = {
      get t() {
        return slice.t();
      },
      get z() {
        return slice.z();
      },
      c: [index],
    };
    return new ImageLayer({
      source,
      sliceCoords,
      policy,
      channelProps: styles,
      blendMode: index > 0 ? "additive" : "normal",
    });
  });
}

/** Fetch omero channel metadata, tolerating stores that omit it. */
export function loadOmero(source: OmeZarrImageSource) {
  return loadOmeroChannels(source).catch(() => null);
}
