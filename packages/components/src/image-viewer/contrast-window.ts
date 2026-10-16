import type { ChannelStat } from "@ndea/protocol";

export interface ContrastWindow {
  start: number;
  end: number;
  min: number;
  max: number;
}
export function resolveContrastWindow(window: ContrastWindow | undefined): [number, number] {
  if (!window) return [0, 65535];
  const { start, end, min, max } = window;
  const range = max - min;
  return [start, range > 1000 && start === min && end === max ? min + range / 16 : end];
}
export function resolveContrastRange(window: ContrastWindow | undefined): [number, number] {
  if (!window) return [0, 65535];
  const { start, end, min, max } = window;
  const range = max - min;
  return [min, range > 1000 && start === min && end === max ? min + range / 8 : max];
}
export function safeContrastLimits(limits: [number, number]): [number, number] {
  return limits[0] < limits[1] ? limits : [limits[0], limits[0] + 1];
}
export type AutoContrastMethod = "percentile" | "minmax";
export function deriveAutoLimits(stat: ChannelStat, method: AutoContrastMethod): [number, number] {
  return safeContrastLimits(method === "minmax" ? [stat.dataMin, stat.dataMax] : [stat.lo, stat.hi]);
}
