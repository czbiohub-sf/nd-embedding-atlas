export interface MenuItem {
  label?: string;
  icon?: string;
  /** Right-aligned muted text: value, count or shortcut. */
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  /** Section heading row. */
  heading?: string;
  onSelect?: () => void;
}
export interface MenuProps { items: MenuItem[]; onSelect?: (item: MenuItem) => void; style?: React.CSSProperties }
export declare function Menu(props: MenuProps): JSX.Element;
