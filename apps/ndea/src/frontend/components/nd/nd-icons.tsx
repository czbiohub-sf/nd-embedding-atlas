/**
 * ND_ICONS: the shared icon registry for node-workspace header buttons.
 *
 * Every icon is drawn on a 10×10 grid. Font glyphs (⛶ ◎ ⚙ ⊞ …) carry
 * asymmetric ink in their em box and never center optically; geometric SVG
 * centers by construction. Add new icons HERE: never inline a glyph in a
 * button (spec: component-spec/Node Component Spec.html).
 */

export const ND_ICONS = {
  "form-chip": <rect x="1" y="3" width="8" height="4" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />,
  "form-card": (
    <g>
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="1.5" y1="4" x2="8.5" y2="4" stroke="currentColor" strokeWidth="1" />
    </g>
  ),
  "form-full": (
    <path
      d="M1.5 3.5 V1.5 H3.5 M6.5 1.5 H8.5 V3.5 M8.5 6.5 V8.5 H6.5 M3.5 8.5 H1.5 V6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    />
  ),
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
  "lock-open": <circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1" />,
  lock: (
    <g>
      <circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="5" cy="5" r="1.5" fill="currentColor" />
    </g>
  ),
  config: (
    <g>
      <line x1="1" y1="3.2" x2="9" y2="3.2" stroke="currentColor" strokeWidth="1" />
      <circle cx="6.4" cy="3.2" r="1.3" fill="currentColor" />
      <line x1="1" y1="6.8" x2="9" y2="6.8" stroke="currentColor" strokeWidth="1" />
      <circle cx="3.6" cy="6.8" r="1.3" fill="currentColor" />
    </g>
  ),
  info: (
    <g fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
      <circle cx="5" cy="5" r="4" />
      <line x1="5" y1="4.6" x2="5" y2="7.2" />
      <circle cx="5" cy="2.8" r="0.35" fill="currentColor" stroke="none" />
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
  "pin-up": (
    <g>
      <line x1="2.5" y1="1.5" x2="7.5" y2="1.5" stroke="currentColor" strokeWidth="1" />
      <path
        d="M5 8.5 V3.3 M3.4 5 L5 3.3 L6.6 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </g>
  ),
  "pin-down": (
    <g>
      <line x1="2.5" y1="8.5" x2="7.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
      <path
        d="M5 1.5 V6.7 M3.4 5 L5 6.7 L6.6 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
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
  freeze: (
    <g>
      <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M5 3.2 V6.8 M3.2 5 H6.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </g>
  ),
  lasso: <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.8 1.6" />,
  enter: (
    <g>
      <path d="M6.5 1.5 H8.5 V8.5 H6.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path
        d="M1 5 H5.8 M4 3.2 L5.8 5 L4 6.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </g>
  ),
  up: (
    <g>
      <line x1="2.5" y1="1.5" x2="7.5" y2="1.5" stroke="currentColor" strokeWidth="1" />
      <path
        d="M5 8.5 V3.4 M3.2 5.2 L5 3.4 L6.8 5.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </g>
  ),
  tidy: (
    <g>
      <rect x="1.5" y="2" width="3" height="2.4" fill="currentColor" opacity="0.85" />
      <rect x="1.5" y="5.8" width="3" height="2.4" fill="currentColor" opacity="0.85" />
      <rect x="6" y="3.9" width="3" height="2.4" fill="currentColor" opacity="0.85" />
      <path d="M4.5 3.2 L6 5.1 M4.5 7 L6 5.1" stroke="currentColor" strokeWidth="0.8" fill="none" />
    </g>
  ),
  bypass: (
    <g>
      <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="2.3" y1="7.7" x2="7.7" y2="2.3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </g>
  ),
  power: (
    <g>
      <path
        d="M3.1 2.9 A3.3 3.3 0 1 0 6.9 2.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line x1="5" y1="1" x2="5" y2="4.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </g>
  ),
} as const;

export type NdIconName = keyof typeof ND_ICONS;

export function NdIcon({ name, size = 9 }: { name: NdIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className="block shrink-0">
      {ND_ICONS[name]}
    </svg>
  );
}
