export interface ScopeDot { key: string; color: string }
export interface ScopeIndicatorProps {
  /** Scopes this tile belongs to, e.g. [{key:'F1',color:'var(--scope-filter)'}]. */
  scopes: ScopeDot[];
  /** Its popover is open. */
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** Hovering should highlight every tile in these scopes. */
  onHover?: (on: boolean) => void;
}
export declare function ScopeIndicator(props: ScopeIndicatorProps): JSX.Element;
export interface ScopeRowProps { name: string; scopeKey: string; color: string; value?: string; members?: string; onUnlink?: () => void; onHover?: (on: boolean) => void }
export declare function ScopeRow(props: ScopeRowProps): JSX.Element;
