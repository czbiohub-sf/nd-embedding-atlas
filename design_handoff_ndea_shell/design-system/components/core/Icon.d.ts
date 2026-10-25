export interface IconProps {
  /** Lucide icon name in kebab-case (e.g. "settings-2"), or an ndea custom icon ("nd-legend", "nd-scopes", "nd-embedding", "nd-crops", "nd-slot", "nd-split", "nd-axis-swap", "nd-color-by", "nd-channels", "nd-harness"). */
  name: string;
  /** Pixel size. 13–15 in tile headers, 14 default. */
  size?: number;
  /** Stroke width. 1.5 default; never above 2. */
  strokeWidth?: number;
  color?: string;
  /** Accessible label; omit for decorative icons. */
  title?: string;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): JSX.Element;
export declare const CUSTOM_ICONS: Record<string, string>;
