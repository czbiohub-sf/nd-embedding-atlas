export interface TileProps {
  title?: string;
  subtitle?: string;
  /** Replaces the title with a Tabs control. */
  tabs?: React.ReactNode;
  /** Right-aligned header controls: color-by, scope indicator, IconButtons. */
  actions?: React.ReactNode;
  /** Linked-scope hover highlight. */
  highlighted?: boolean;
  /** Not in the hovered scope. */
  dimmed?: boolean;
  /** 0 6px 6px body padding; false for full-bleed canvases (scatter, image). */
  padded?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}
/** @startingPoint section="Layout" subtitle="Dashboard tile with header and actions" viewport="700x320" */
export declare function Tile(props: TileProps): JSX.Element;
export interface TileSlotProps { onChoose?: () => void; label?: string; hint?: string }
export declare function TileSlot(props: TileSlotProps): JSX.Element;
