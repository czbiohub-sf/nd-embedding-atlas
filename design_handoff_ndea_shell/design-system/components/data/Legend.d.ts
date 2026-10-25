export interface LegendItem { label: string; color: string; count?: string | number; active?: boolean }
export interface LegendProps {
  /** Color-by field name, e.g. "treatment". */
  title: string;
  mode?: 'categorical' | 'continuous';
  items?: LegendItem[];
  /** Continuous range labels. */
  min?: string; max?: string;
  /** Clicking a row toggles it in the F1 filter. */
  onToggle?: (label: string) => void;
  onClear?: () => void;
  hasFilter?: boolean;
  style?: React.CSSProperties;
}
export declare function Legend(props: LegendProps): JSX.Element;
