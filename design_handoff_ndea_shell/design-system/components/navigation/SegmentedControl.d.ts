export interface SegmentedOption { value: string; label: React.ReactNode; title?: string }
export interface SegmentedControlProps {
  options: Array<string | SegmentedOption>;
  value: string;
  onChange?: (value: string) => void;
  /** sm for tile settings rows; md for dialogs and the command menu. */
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}
/** @startingPoint section="Navigation" subtitle="Sliding segmented switch" viewport="700x160" */
export declare function SegmentedControl(props: SegmentedControlProps): JSX.Element;
