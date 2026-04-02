import type { ChannelProps, ChannelsEnabled, Layer } from "@idetik/core";

/** A layer that implements both Layer (for layerManager) and ChannelsEnabled (for channel controls). */
type ChannelLayer = ChannelsEnabled & Layer;

/**
 * Aggregates one or more ChannelsEnabled layers into a single interface.
 *
 * Supports two patterns:
 * - **Multi-layer** (2D): N ChunkedImageLayers, each with 1 channel.
 *   `setChannelProps` delegates `[props]` to each layer individually.
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

    // Multi-layer: one channel prop per layer
    for (const layer of this.layers_) {
      const props = layer.channelProps;
      if (props === undefined || props.length === 0) {
        this.channelProps_ = undefined;
        return this.channelProps_;
      }
      this.channelProps_.push(props[0]);
    }
    return this.channelProps_;
  }

  setChannelProps(channelProps: ChannelProps[]): void {
    if (this.singleLayerMultiChannel_) {
      // Single layer owns all channels — pass the full array
      this.layers_[0].setChannelProps(channelProps);
    } else {
      // Multi-layer — one prop per layer
      for (const [index, props] of channelProps.entries()) {
        const layer = this.layers_[index];
        const existing = layer?.channelProps;
        if (existing && existing[0] !== props) {
          layer.setChannelProps([props]);
        }
      }
    }
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
