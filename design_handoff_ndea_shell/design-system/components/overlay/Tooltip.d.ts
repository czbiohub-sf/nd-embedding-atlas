export interface TooltipProps {
  /** Short label: what the control does, plus its shortcut ("Lasso · L"). */
  content: React.ReactNode;
  side?: 'top' | 'bottom';
  /** Open delay in ms. Moving to a neighbouring trigger within 300ms opens instantly. */
  delay?: number;
  children: React.ReactNode;
}
export declare function Tooltip(props: TooltipProps): JSX.Element;
