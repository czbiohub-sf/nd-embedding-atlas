import type { ChannelProps, ChannelsEnabled, Layer } from "@idetik/core";

/** A layer that implements both Layer (for layerManager) and ChannelsEnabled (for channel controls). */
type ChannelLayer = ChannelsEnabled & Layer;

/**
 * Aggregates one or more ChannelsEnabled layers into a single interface.
 *
 * Supports two patterns:
 * - **Multi-layer** (2D): N ImageLayers, each rendering one channel
 *   (selected via `sliceCoords.c: [i]`). Per @idetik/core@0.23+, every
 *   ImageLayer's `channelProps` array must have length === source channel
 *   count, so every layer holds the full per-channel styling array — but
 *   only the entry at `[i]` (matching the layer's slice index) is actually
 *   drawn for layer `i`.
 * - **Single-layer** (3D): 1 VolumeLayer with N channels.
 *   `setChannelProps` passes all props to the single layer.
 *
 * Adapted from idetik-react's MultiChannelLayers.
 */
export class MultiChannelLayers implements ChannelsEnabled {
  private readonly layers_: readonly ChannelLayer[];
  private readonly singleLayerMultiChannel_: boolean;
  private readonly channelChangeCallbacks_: Set<() => void> = new Set();
  // Cached value to avoid infinite snapshots via getSyncExternalStore.
  // Empty array = "not yet computed", undefined = "no channelProps available".
  private channelProps_?: ChannelProps[] = [];

  constructor(layers: readonly ChannelLayer[]) {
    if (layers.length === 0) {
      throw new Error("MultiChannelLayers requires at least one layer.");
    }
    this.layers_ = layers;
    // Detect mode: if there's exactly one layer, it owns all channels (volume mode)
    this.singleLayerMultiChannel_ = layers.length === 1;
    for (const layer of this.layers_) {
      layer.addChannelChangeCallback(this.notifyCallbacks);
    }
  }

  get layers(): readonly ChannelLayer[] {
    return this.layers_;
  }

  get channelProps(): ChannelProps[] | undefined {
    if (this.channelProps_ === undefined || this.channelProps_.length > 0) {
      return this.channelProps_;
    }

    if (this.singleLayerMultiChannel_) {
      // Single layer owns all channels (VolumeLayer)
      const props = this.layers_[0].channelProps;
      if (props === undefined || props.length === 0) {
        this.channelProps_ = undefined;
      } else {
        this.channelProps_ = [...props];
      }
      return this.channelProps_;
    }

    // Multi-layer: each layer holds the full per-channel array but only its
    // slot `i` (matching `sliceCoords.c: [i]`) is drawn. Pick slot `i` from
    // layer `i` to build the user-facing aggregate.
    for (const [i, layer] of this.layers_.entries()) {
      const props = layer.channelProps;
      if (props === undefined || props.length <= i) {
        this.channelProps_ = undefined;
        return this.channelProps_;
      }
      this.channelProps_.push(props[i]);
    }
    return this.channelProps_;
  }

  setChannelProps(channelProps: ChannelProps[]): void {
    if (this.singleLayerMultiChannel_) {
      // Single layer owns all channels — pass the full array
      this.layers_[0].setChannelProps(channelProps);
    } else {
      // Multi-layer — every layer's channelProps must equal source channel
      // count. Push the same full array to all layers; each layer's `c: [i]`
      // ensures only slot `i` actually renders.
      for (const layer of this.layers_) {
        layer.setChannelProps(channelProps);
      }
    }
    this.applyImageLayerVisibility(channelProps);
  }

  /**
   * Apply per-channel visibility to 2D ImageLayers via layer opacity.
   *
   * idetik's 2D `ImageRenderable.getUniforms()` ignores `ChannelProps.visible`
   * entirely (only the 3D `VolumeRenderable` honors it), so toggling `visible`
   * has no rendered effect on ImageLayers. Each ImageLayer renders exactly one
   * channel (slice `c: [i]`), so layer `i` ↔ channel `i`; drive its visibility
   * through opacity instead. Opacity fully hides under the default `normal`
   * (base) and `additive` blend modes — both fold src-alpha into the result.
   *
   * The single-layer VolumeLayer (3D) is left untouched: its opacity is
   * volume-wide, and it already honors per-channel `visible` directly.
   */
  private applyImageLayerVisibility(channelProps: ChannelProps[]): void {
    this.layers_.forEach((layer, i) => {
      if (layer.type === "ImageLayer") {
        layer.opacity = channelProps[i]?.visible === false ? 0 : 1;
      }
    });
  }

  resetChannelProps(): void {
    for (const layer of this.layers_) {
      layer.resetChannelProps();
    }
  }

  addChannelChangeCallback(callback: () => void): void {
    this.channelChangeCallbacks_.add(callback);
  }

  removeChannelChangeCallback(callback: () => void): void {
    this.channelChangeCallbacks_.delete(callback);
  }

  private notifyCallbacks = (): void => {
    this.channelProps_ = [];
    for (const cb of this.channelChangeCallbacks_) {
      cb();
    }
  };

  dispose(): void {
    for (const layer of this.layers_) {
      layer.removeChannelChangeCallback(this.notifyCallbacks);
    }
    this.channelChangeCallbacks_.clear();
  }
}
