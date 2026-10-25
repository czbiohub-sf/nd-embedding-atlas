export interface ButtonProps {
  /** primary = one per surface (Save, Accept). secondary = default. accent = soft selection-colored. ghost = toolbar/tool buttons. destructive = Discard/Delete. */
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost' | 'destructive';
  /** sm (toolbars, 11.5px) or md (dialogs, 12.5px). */
  size?: 'sm' | 'md';
  /** Lucide or nd-* icon before the label. */
  icon?: string;
  iconRight?: string;
  /** Ghost buttons only: shows the active (filter applied) state. */
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
/** @startingPoint section="Core" subtitle="Toolbar and dialog buttons" viewport="700x200" */
export declare function Button(props: ButtonProps): JSX.Element;
