export interface CheckboxProps {
  checked?: boolean;
  /** Header "some rows selected" state. */
  indeterminate?: boolean;
  onChange?: (next: boolean, e: React.SyntheticEvent) => void;
  label?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
