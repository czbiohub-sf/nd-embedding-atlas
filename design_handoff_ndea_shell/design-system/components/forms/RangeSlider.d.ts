export interface RangeSliderProps {
  /** Lower contrast limit, 0..1. */
  low?: number;
  /** Upper contrast limit, 0..1. */
  high?: number;
  onChange?: (low: number, high: number) => void;
  /** Intensity histogram bin counts drawn behind the track. */
  histogram?: number[];
  /** Channel color for the in-range bins and track. */
  color?: string;
  /** Formats limits for the readout. Default maps 0..1 to 0..4095. */
  format?: (x: number) => string;
  width?: number | string;
}
export declare function RangeSlider(props: RangeSliderProps): JSX.Element;
