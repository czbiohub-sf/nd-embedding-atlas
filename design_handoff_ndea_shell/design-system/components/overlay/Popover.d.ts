export interface PopoverProps {
  title?: string;
  /** Muted text beside the title, e.g. the tile name. */
  meta?: string;
  /** Footer row (actions), separated by a keyline. */
  footer?: React.ReactNode;
  width?: number | string;
  maxHeight?: number | string;
  /** Absolute position inside the nearest positioned ancestor. Flip upward yourself when there is no room below. */
  x?: number | string;
  y?: number | string;
  /** When set, renders a transparent click-away layer. */
  onClose?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Popover(props: PopoverProps): JSX.Element;
