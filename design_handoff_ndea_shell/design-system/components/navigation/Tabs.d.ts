export interface TabItem { value: string; label: string; icon?: string }
export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange?: (value: string) => void;
  /** Shows an x on the active tab when more than one tab exists. */
  onClose?: (value: string) => void;
  /** Shows a trailing + to add a component as a new tab. */
  onAdd?: () => void;
  style?: React.CSSProperties;
}
export declare function Tabs(props: TabsProps): JSX.Element;
