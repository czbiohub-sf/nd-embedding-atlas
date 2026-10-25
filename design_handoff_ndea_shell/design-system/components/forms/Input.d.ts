export interface InputProps {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  /** Use the mono face for values (ids, numbers, expressions). */
  mono?: boolean;
  /** Leading icon, e.g. "search". */
  icon?: string;
  width?: number | string;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}
export declare function Input(props: InputProps): JSX.Element;
