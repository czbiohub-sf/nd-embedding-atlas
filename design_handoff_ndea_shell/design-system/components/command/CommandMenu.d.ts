export interface CommandItem {
  label: string;
  sub?: string;
  /** Right-aligned mono text (count, "current"). */
  meta?: string;
  /** Leading visual, e.g. a mini layout wireframe or chevron. */
  leading?: React.ReactNode;
  /** Tree indent level (collection > plate). */
  depth?: number;
  current?: boolean;
  onSelect?: () => void;
}
export interface CommandGroup { heading: string; meta?: string; items: CommandItem[] }
export interface CommandMenuProps {
  open?: boolean;
  onClose?: () => void;
  /** Switching targets shown by default: Layouts, Collections, Other projects. */
  groups: CommandGroup[];
  /** Shown when the query starts with ">". */
  commands?: CommandItem[];
  placeholder?: string;
  /** Renders the right preview pane for the highlighted item. Keep the pane always present so the window never resizes. */
  preview?: (item: CommandItem | undefined) => React.ReactNode;
  width?: number;
}
/** @startingPoint section="Overlay" subtitle="⌘K switcher with preview" viewport="900x520" */
export declare function CommandMenu(props: CommandMenuProps): JSX.Element;
