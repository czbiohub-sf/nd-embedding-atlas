export interface RailItem { id: string; icon: string; label: string; active?: boolean; /** Small status dot color, e.g. var(--dirty). */ dot?: string; separator?: boolean }
export interface SidebarRailProps {
  logo?: React.ReactNode;
  items: RailItem[];
  /** Pinned to the bottom (settings, harness). */
  footer?: RailItem[];
  onSelect?: (id: string) => void;
  /** Content of the open flyout (layouts, data, links, harness). Omit when closed. */
  flyout?: React.ReactNode;
  flyoutTitle?: string;
  onCloseFlyout?: () => void;
  height?: number | string;
  style?: React.CSSProperties;
}
/** @startingPoint section="Navigation" subtitle="Icon rail with overlay flyout" viewport="700x360" */
export declare function SidebarRail(props: SidebarRailProps): JSX.Element;
