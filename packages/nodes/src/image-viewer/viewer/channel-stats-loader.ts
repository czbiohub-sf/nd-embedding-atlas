import type { ChannelStat } from "@ndea/protocol";

export type ChannelStatsLoader = (
  fovName: string,
  datasetKey?: string,
  signal?: AbortSignal,
) => Promise<readonly ChannelStat[] | null>;

export interface LoadOptionalChannelStatsOptions {
  fovName: string;
  datasetKey?: string;
  signal?: AbortSignal;
  load?: ChannelStatsLoader;
  warn?: (...args: unknown[]) => void;
}

/** Optional autocontrast boundary: stats failure must never block channel setup. */
export async function loadOptionalChannelStats({
  fovName,
  datasetKey,
  signal,
  load,
  warn = console.warn,
}: LoadOptionalChannelStatsOptions): Promise<readonly ChannelStat[] | null> {
  if (!load) return null;

  try {
    return await load(fovName, datasetKey, signal);
  } catch (error) {
    if (!signal?.aborted) {
      warn(`[useFovLoader] Failed to load channel stats for FOV ${fovName}:`, error);
    }
    return null;
  }
}
