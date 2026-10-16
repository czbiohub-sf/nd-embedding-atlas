/**
 * ICONS: the shared icon registry for dashboard element header buttons.
 *
 * Every icon is drawn on a 10×10 grid. Font glyphs (⛶ ◎ ⚙ ⊞ …) carry
 * asymmetric ink in their em box and never center optically; geometric SVG
 * centers by construction. Add new icons HERE: never inline a glyph in a
 * button.
 */

export const ICONS = {
  fullscreen: (
    <g>
      <path
        d="M1 3 V1 H3 M7 1 H9 V3 M9 7 V9 H7 M3 9 H1 V7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <rect x="4" y="4" width="2" height="2" rx="0.5" fill="currentColor" />
    </g>
  ),
  split: (
    <g>
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="5" y1="1.5" x2="5" y2="8.5" stroke="currentColor" strokeWidth="1" />
      <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="1" />
    </g>
  ),
  "split-left": (
    <g>
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="5" y1="1.5" x2="5" y2="8.5" stroke="currentColor" strokeWidth="1" />
      <rect x="2.1" y="2.1" width="2.4" height="5.8" fill="currentColor" opacity="0.55" />
    </g>
  ),
  "split-right": (
    <g>
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="5" y1="1.5" x2="5" y2="8.5" stroke="currentColor" strokeWidth="1" />
      <rect x="5.5" y="2.1" width="2.4" height="5.8" fill="currentColor" opacity="0.55" />
    </g>
  ),
  "split-up": (
    <g>
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="1" />
      <rect x="2.1" y="2.1" width="5.8" height="2.4" fill="currentColor" opacity="0.55" />
    </g>
  ),
  "split-down": (
    <g>
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="1" />
      <rect x="2.1" y="5.5" width="5.8" height="2.4" fill="currentColor" opacity="0.55" />
    </g>
  ),
  close: (
    <path
      d="M2.8 2.8 L7.2 7.2 M7.2 2.8 L2.8 7.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    />
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 9 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className="block shrink-0">
      {ICONS[name]}
    </svg>
  );
}
