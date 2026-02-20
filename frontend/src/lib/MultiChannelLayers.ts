import type { ChannelProps, ChannelsEnabled, ChunkedImageLayer } from "@idetik/core";

/**
 * Aggregates multiple ChunkedImageLayers and presents them as a single
 * ChannelsEnabled interface for use with ChannelControlsList.
 *
 * Each layer manages one channel, and this wrapper aggregates their
 * channelProps and distributes updates to the correct layer.
 *
 * Adapted from idetik-react's MultiChannelLayers.
 */
export class MultiChannelLayers implements ChannelsEnabled {
  private readonly layers_: ReadonlyArray<ChunkedImageLayer>;
  private readonly channelChangeCallbacks_: Set<() => void> = new Set();
  // Cached value to avoid infinite snapshots via getSyncExternalStore.
  // Empty array = "not yet computed", undefined = "no channelProps available".
  private channelProps_?: ChannelProps[] = [];

  constructor(layers: ReadonlyArray<ChunkedImageLayer>) {
    if (layers.length === 0) {
      throw new Error("MultiChannelLayers requires at least one layer.");
    }
    this.layers_ = layers;
    for (const layer of this.layers_) {
      layer.addChannelChangeCallback(this.notifyCallbacks);
    }
  }

  get layers(): ReadonlyArray<ChunkedImageLayer> {
    return this.layers_;
  }

  get channelProps(): ChannelProps[] | undefined {
    if (this.channelProps_ === undefined || this.channelProps_.length > 0) {
      return this.channelProps_;
    }
    for (const layer of this.layers_) {
      const props = layer.channelProps;
      if (props === undefined || props.length === 0) {
        this.channelProps_ = undefined;
        return this.channelProps_;
      }
      if (props.length > 1) {
        console.warn("MultiChannelLayers: expected one channel prop per layer, got", props.length);
      }
      this.channelProps_.push(props[0]);
    }
    return this.channelProps_;
  }

  setChannelProps(channelProps: ChannelProps[]): void {
    for (const [index, props] of channelProps.entries()) {
      const layer = this.layers_[index];
      const existing = layer?.channelProps;
      if (existing && existing[0] !== props) {
        layer.setChannelProps([props]);
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
