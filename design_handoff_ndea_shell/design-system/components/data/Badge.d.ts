export interface BadgeProps {
  /** default = neutral count; accent = current/selected; primary = strong; destructive = error; outline = quiet. */
  tone?: 'default' | 'accent' | 'primary' | 'destructive' | 'outline';
  mono?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): JSX.Element;
