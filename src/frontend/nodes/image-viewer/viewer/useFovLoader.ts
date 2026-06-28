import {
  Color,
  createPlaybackPolicy,
  ImageLayer,
  loadOmeroChannels,
  OmeZarrImageSource,
  VolumeLayer,
} from "@idetik/core";
import { useEffect, useRef } from "react";
import { resolveContrastWindow, safeContrastLimits } from "@/lib/contrast-window";
import type { Metadata } from "@/types";
import { MultiChannelLayers } from "./MultiChannelLayers";
import { useViewer } from "./useViewer";
import type { ChannelDef, ViewMode } from "./ViewerContext";

// idetik 0.27 no longer exports the `OmeroChannel` type; derive it from the
// still-exported `loadOmeroChannels` return.
type OmeroChannel = Awaited<ReturnType<typeof loadOmeroChannels>>[number];

// ── Module-level zarr source cache ────────────────────────────────────────────
// Keyed by sourceUrl; avoids re-fetching zarr metadata for recently-visited FOVs.

/** Minimal interface for the idetik loader exposed by `OmeZarrImageSource.loader`. */
interface IdetikLoader {
  getSourceDimensionMap(): {
    x: { lods: { size: number; scale?: number; translation?: number }[] };
    y: { lods: { size: number; scale?: number; translation?: number }[] };
    z?: { lods: { size: number }[] };
    t?: { lods: { size: number }[] };
  };
}

interface CachedSource {
  source: OmeZarrImageSource;
  loader: IdetikLoader;
  omeroChannels: OmeroChannel[] | null;
}
const SOURCE_CACHE = new Map<string, CachedSource>();
const SOURCE_CACHE_MAX = 5;

interface UseFovLoaderOptions {
  sourceUrl: string | null;
  plateChannels: Metadata["plate_channels"];
  omeVersion?: "0.4" | "0.5";
}

/**
 * Loads OME-Zarr FOV layers into the current Viewer context.
 *
 * In 2D mode, creates one ImageLayer per channel with a specific Z slice.
 * In 3D mode, creates a single VolumeLayer with all channels and z: undefined
 * (loads the full Z stack for ray marching).
 */
export function useFovLoader({ sourceUrl, plateChannels, omeVersion }: UseFovLoaderOptions): void {
  const { state: viewerState, actions } = useViewer();
  const { viewMode } = viewerState;
  // ── Refs for reactive sliceCoords getters ─────────────────────────
  const zRef = useRef(0);
  const tRef = useRef(0);

  useEffect(() => {
    zRef.current = viewerState.zIndex;
  }, [viewerState.zIndex]);
  useEffect(() => {
    tRef.current = viewerState.tIndex;
  }, [viewerState.tIndex]);

  // ── Stable refs for deps that shouldn't trigger reloads ───────────
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const plateChsRef = useRef(plateChannels);
  plateChsRef.current = plateChannels;
  const omeVersionRef = useRef(omeVersion);
  omeVersionRef.current = omeVersion;

  // ── FOV caching refs ──────────────────────────────────────────────
  const currentFovRef = useRef<string | null>(null);
  const currentModeRef = useRef<ViewMode>(viewMode);
  const currentGenRef = useRef(viewerState.generation);
  const multiChannelRef = useRef<MultiChannelLayers | null>(null);
  const sourceRef = useRef<OmeZarrImageSource | null>(null);

  // ── Main FOV load effect ──────────────────────────────────────────
  useEffect(() => {
    console.log("[useFovLoader] effect fired", {
      sourceUrl,
      initialized: viewerState.initialized,
      viewMode,
      generation: viewerState.generation,
      currentFov: currentFovRef.current,
      currentMode: currentModeRef.current,
      currentGen: currentGenRef.current,
    });

    if (!sourceUrl || !viewerState.initialized) return () => {};

    // Skip if same FOV + same mode + same generation (runtime hasn't been recreated)
    if (
      sourceUrl === currentFovRef.current &&
      viewMode === currentModeRef.current &&
      viewerState.generation === currentGenRef.current
    ) {
      console.log("[useFovLoader] early-exit (no structural change)");
      return () => {};
    }

    console.log("[useFovLoader] reloading", {
      sourceUrl,
      viewMode,
      generation: viewerState.generation,
    });

    let cancelled = false;

    const loadLayers = async () => {
      console.log("[useFovLoader] loadLayers started", sourceUrl);
      // Dispose previous MultiChannelLayers
      if (multiChannelRef.current) {
        multiChannelRef.current.dispose();
        multiChannelRef.current = null;
      }
      sourceRef.current = null;

      // Use cached source if available — avoids re-fetching zarr metadata
      const hit = SOURCE_CACHE.get(sourceUrl);
      let cached: CachedSource;
      if (hit) {
        cached = hit;
        console.log("[useFovLoader] source cache hit", sourceUrl);
      } else {
        // 0.27: `fromHttp` is async and returns the opened source; the loader is
        // now a getter (`.loader`, no more `.open()`), and omero metadata comes
        // from the exported `loadOmeroChannels(source)`.
        const source = await OmeZarrImageSource.fromHttp({
          url: sourceUrl,
          version: omeVersionRef.current ?? "0.4",
        });
        const omeroChannels = await loadOmeroChannels(source).catch(() => null);
        if (SOURCE_CACHE.size >= SOURCE_CACHE_MAX) {
          const oldest = SOURCE_CACHE.keys().next().value;
          if (oldest !== undefined) SOURCE_CACHE.delete(oldest);
        }
        cached = { source, loader: source.loader, omeroChannels };
        SOURCE_CACHE.set(sourceUrl, cached);
        console.log("[useFovLoader] source cache miss — fetched metadata", sourceUrl);
      }
      const { source, loader, omeroChannels } = cached;

      if (cancelled) return;

      // Set Z/T bounds + world-space translation from source dimensions.
      // Translation lets the camera target the image origin instead of (0,0)
      // — HCS plates embed each FOV's plate position in the OME-Zarr
      // coordinateTransformations.translation, so without this the camera
      // looks at empty space.
      try {
        const dims = loader.getSourceDimensionMap();
        const zMax = dims.z ? dims.z.lods[0].size - 1 : null;
        const tMax = dims.t ? dims.t.lods[0].size - 1 : null;
        const tx = dims.x.lods[0].translation ?? 0;
        const ty = dims.y.lods[0].translation ?? 0;
        const sx = dims.x.lods[0].scale;
        const sy = dims.y.lods[0].scale;
        const translation = tx !== 0 || ty !== 0 ? { x: tx, y: ty } : null;
        const scale = sx != null && sy != null ? { x: sx, y: sy } : null;
        console.log("[useFovLoader] setBounds", { zMax, tMax, translation, scale });
        actionsRef.current.setBounds({ zMax, tMax, translation, scale });
      } catch (e) {
        console.warn("[useFovLoader] getSourceDimensionMap failed", e);
      }

      // Resolve channel definitions
      let channelDefs: { color: Color; contrastLimits: [number, number] }[];
      if (omeroChannels) {
        channelDefs = omeroChannels.map((ch) => ({
          color: ch.color ? Color.fromRgbHex(`#${ch.color}`) : Color.WHITE,
          contrastLimits: safeContrastLimits(resolveContrastWindow(ch.window)),
        }));
      } else if (plateChsRef.current) {
        channelDefs = plateChsRef.current.map((ch) => ({
          color: Color.fromRgbHex(`#${ch.color}`),
          contrastLimits: safeContrastLimits(resolveContrastWindow(ch.window)),
        }));
      } else {
        channelDefs = [{ color: Color.WHITE, contrastLimits: [0, 65535] }];
      }

      console.log(
        "[useFovLoader] contrastLimits per channel:",
        channelDefs.map((ch, i) => `ch${i}: [${ch.contrastLimits[0]}, ${ch.contrastLimits[1]}]`),
      );

      if (cancelled) return;

      // ── Create layers based on view mode ─────────────────────────
      let multiChannel: MultiChannelLayers;
      let layerEntries: { id: string; layer: ImageLayer | VolumeLayer }[];

      if (viewMode === "3d") {
        // 3D: single VolumeLayer with all channels
        const policy = createPlaybackPolicy({
          lod: { min: 0, bias: 0.5 },
          prefetch: { x: 0, y: 0, z: 0, t: 0 },
          priorityOrder: ["visibleCurrent", "fallbackVisible", "prefetchTime", "prefetchSpace", "fallbackBackground"],
        });
        const sliceCoords = {
          get t() {
            return tRef.current;
          },
          z: undefined as number | undefined,
          c: undefined as number[] | undefined,
        };
        const volumeLayer = new VolumeLayer({
          source,
          sliceCoords,
          policy,
          channelProps: channelDefs.map((ch) => ({
            color: ch.color,
            contrastLimits: ch.contrastLimits,
          })),
        });
        multiChannel = new MultiChannelLayers([volumeLayer]);
        layerEntries = [{ id: "volume", layer: volumeLayer }];
      } else {
        // 2D: one ImageLayer per channel.
        // priorityOrder omits fallbackBackground/prefetchSpace to prevent idetik from
        // loading the entire image as a background task (very expensive with single-LOD data).
        const policy = createPlaybackPolicy({
          prefetch: { x: 0, y: 0, z: 0, t: 0 },
          lod: { min: 0, bias: 0.5 },
          priorityOrder: ["visibleCurrent", "fallbackVisible", "prefetchTime", "prefetchSpace", "fallbackBackground"],
        });
        // v0.23+ requires channelProps.length === source.channelCount on every
        // ImageLayer, even when sliceCoords.c selects a single channel. Each
        // layer gets the full per-channel styling array; `c: [i]` then picks
        // which slot actually renders. The non-active entries are unused
        // (no texture is loaded for them) but must be present to pass
        // validateChannelPropsCount.
        const allChannelProps = channelDefs.map((ch) => ({
          color: ch.color,
          contrastLimits: ch.contrastLimits,
        }));
        const imageLayers = channelDefs.map((_ch, i) => {
          const sliceCoords = {
            get t() {
              return tRef.current;
            },
            get z() {
              return zRef.current;
            },
            c: [i],
          };
          return new ImageLayer({
            source,
            sliceCoords,
            // The base channel renders with "normal" rather than the default
            // "none": "none" disables GPU blending, which makes the fragment's
            // alpha (and therefore layer opacity) a no-op — so visibility
            // toggling via opacity would silently fail for channel 0. "normal"
            // is pixel-identical over the cleared (black) framebuffer at full
            // opacity, and lets opacity=0 hide the layer. Matches the channel's
            // own ChannelDef blendMode ("normal" for the base in 2D).
            policy,
            channelProps: allChannelProps,
            blendMode: i > 0 ? "additive" : "normal",
          });
        });
        multiChannel = new MultiChannelLayers(imageLayers);
        layerEntries = imageLayers.map((layer, i) => ({ id: `ch-${i}`, layer }));
      }

      if (cancelled) return;

      console.log("[useFovLoader] setLayers called", sourceUrl, performance.now().toFixed(1));

      // Commit refs
      currentFovRef.current = sourceUrl;
      currentModeRef.current = viewMode;
      currentGenRef.current = viewerState.generation;
      sourceRef.current = source;
      multiChannelRef.current = multiChannel;

      actionsRef.current.setLayers(layerEntries);

      // Build default channel state from source metadata
      const defaultChannelState: ChannelDef[] = channelDefs.map((ch, i) => {
        const label = omeroChannels?.[i]?.label ?? plateChsRef.current?.[i]?.label ?? `Ch ${i}`;
        const hex = ch.color.rgbHex?.substring(1) ?? "FFFFFF";
        return {
          label,
          color: hex,
          visible: true,
          contrastLimits: ch.contrastLimits,
          contrastRange: [plateChsRef.current?.[i]?.window?.min ?? 0, plateChsRef.current?.[i]?.window?.max ?? 65535],
          blendMode: viewMode === "3d" ? "additive" : i > 0 ? "additive" : "normal",
        };
      });

      // Preserve user's channel settings (visibility, contrast, blend) if the
      // channel lineup hasn't changed (same count + labels). This keeps
      // user adjustments stable when clicking between observations in the same plate.
      const existing = viewerState.channels;
      const canReuse =
        existing.length === defaultChannelState.length &&
        existing.every((ch, i) => ch.label === defaultChannelState[i].label);

      const channelState = canReuse
        ? existing.map((ch, i) => ({
            ...ch,
            contrastRange: defaultChannelState[i].contrastRange,
          }))
        : defaultChannelState;

      actionsRef.current.setChannels(channelState, multiChannel);

      // Apply existing user settings to the new layers
      if (canReuse) {
        multiChannel.setChannelProps(
          channelState.map((ch) => ({
            visible: ch.visible,
            color: Color.fromRgbHex(`#${ch.color}`),
            contrastLimits: safeContrastLimits(ch.contrastLimits),
          })),
        );
      }
    };

    loadLayers().catch((err: unknown) => {
      if (!cancelled) {
        console.error(`[useFovLoader] Failed to load FOV layers for ${sourceUrl}:`, err);
      }
    });

    return () => {
      console.log("[useFovLoader] cleanup — cancelling", sourceUrl);
      cancelled = true;
    };
  }, [sourceUrl, viewerState.initialized, viewMode, viewerState.generation, viewerState.channels]);

  // ── Cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (multiChannelRef.current) {
        multiChannelRef.current.dispose();
        multiChannelRef.current = null;
      }
      currentFovRef.current = null;
      sourceRef.current = null;
    };
  }, []);
}
