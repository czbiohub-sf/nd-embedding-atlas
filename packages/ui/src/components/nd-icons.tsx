import type * as React from "react";

/** ndea custom icons (design core/Icon.jsx): Lucide's 24px grid, round caps and joins, Lucide-compatible props. */
type NdIconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & { size?: number | string };

function ndIcon(displayName: string, paths: React.ReactNode) {
  function NdIcon({ size = 14, strokeWidth = 1.75, ...props }: NdIconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  }
  NdIcon.displayName = displayName;
  return NdIcon;
}

export const NdLegendIcon = ndIcon(
  "NdLegendIcon",
  <>
    <circle cx="5" cy="6" r="1.5" />
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="5" cy="18" r="1.5" />
    <path d="M10 6h10M10 12h10M10 18h7" />
  </>,
);

export const NdLegendContinuousIcon = ndIcon(
  "NdLegendContinuousIcon",
  <>
    <rect x="4" y="3" width="4" height="18" rx="2" />
    <path d="M12 5h8M12 12h6M12 19h8" />
  </>,
);

export const NdScopesIcon = ndIcon(
  "NdScopesIcon",
  <>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <path d="M8.5 6h7M7.2 8.2l3.6 7.4M16.8 8.2l-3.6 7.4" />
  </>,
);

export const NdSplitIcon = ndIcon(
  "NdSplitIcon",
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M12 3v18M12 12h9" />
  </>,
);

export const NdAxisSwapIcon = ndIcon(
  "NdAxisSwapIcon",
  <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />,
);

export const NdChannelsIcon = ndIcon(
  "NdChannelsIcon",
  <>
    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
    <path d="m3 13 9 5 9-5" />
    <path d="M12 13v8" strokeDasharray="2 2" />
  </>,
);

export const NdHarnessIcon = ndIcon(
  "NdHarnessIcon",
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
    <circle cx="20" cy="4" r="2" />
  </>,
);
