export interface PillProps {
  label?: string;
  /** Category color dot (var(--d1)…). */
  color?: string;
  count?: string | number;
  selected?: boolean;
  /** Dashed "add" placeholder for an unlabeled annotation cell. */
  empty?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}
export declare function Pill(props: PillProps): JSX.Element;
