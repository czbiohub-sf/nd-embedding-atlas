export interface OverlayButtonProps {
  icon: string;
  /** Tooltip and accessible name, e.g. "Channels" or "Lasso · L". */
  label: string;
  /** Open/pressed: muted fill. */
  active?: boolean;
  /** Set by OverlayGroup: transparent until hovered or active, no own edge. */
  grouped?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function OverlayButton(props: OverlayButtonProps): JSX.Element;
export interface OverlayItem {
  value?: string; icon?: string; label?: string;
  /** Draws a section divider instead of a button. */
  separator?: boolean;
  /** Momentary/toggle action (e.g. Legend) instead of a mode choice; pair with active and onClick. */
  action?: boolean; active?: boolean; onClick?: () => void;
}
export interface OverlayGroupProps {
  items: OverlayItem[];
  value?: string;
  onChange?: (value: string) => void;
  direction?: 'column' | 'row';
  style?: React.CSSProperties;
}
export declare function OverlayGroup(props: OverlayGroupProps): JSX.Element;
