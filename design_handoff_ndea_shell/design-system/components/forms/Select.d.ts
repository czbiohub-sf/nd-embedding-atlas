export interface SelectOption {
  value: string;
  label: string;
  /** Right-aligned muted mono text, e.g. a field type in the filter builder. Leave empty for axis pickers (names only). */
  meta?: string;
}
export interface SelectProps {
  value?: string;
  /** Called with a select-like event and the picked value. */
  onChange?: (e: { target: { value: string } }, value: string) => void;
  options: Array<string | SelectOption>;
  /** Mono face for field names, dimensions and other data values. */
  mono?: boolean;
  width?: number | string;
  placeholder?: string;
  style?: React.CSSProperties;
}
/** @startingPoint section="Forms" subtitle="In-theme dropdown" viewport="700x260" */
export declare function Select(props: SelectProps): JSX.Element;
