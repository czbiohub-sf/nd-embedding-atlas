export interface IconButtonProps {
  icon: string;
  /** Required tooltip and accessible name, e.g. "Tile settings". */
  label: string;
  size?: number;
  /** Pressed/open state (its popover is open). */
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** Optional trailing content, e.g. scope dots. */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
