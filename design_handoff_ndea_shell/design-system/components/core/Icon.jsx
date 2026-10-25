import React from 'react';

const CDN = 'https://unpkg.com/lucide-static@0.469.0/icons/';
const CACHE = {};
// ndea custom icons, drawn on Lucide's 24px grid with round caps and joins.
export const CUSTOM_ICONS = {
  'nd-legend': '<circle cx="5" cy="6" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="5" cy="18" r="1.5"/><path d="M10 6h10M10 12h10M10 18h7"/>',
  'nd-legend-continuous': '<rect x="4" y="3" width="4" height="18" rx="2"/><path d="M12 5h8M12 12h6M12 19h8"/>',
  'nd-scopes': '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.5 6h7M7.2 8.2l3.6 7.4M16.8 8.2l-3.6 7.4"/>',
  'nd-embedding': '<path d="M4 4v16h16"/><circle cx="9" cy="14" r="1"/><circle cx="12" cy="9" r="1"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="7" r="1"/><circle cx="10" cy="10.5" r="1"/>',
  'nd-crops': '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/><circle cx="6.75" cy="6.75" r="1.5"/><circle cx="17.25" cy="17.25" r="1.5"/>',
  'nd-slot': '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><path d="M12 9v6M9 12h6"/>',
  'nd-split': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M12 12h9"/>',
  'nd-axis-swap': '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
  'nd-color-by': '<circle cx="7" cy="12" r="3"/><circle cx="12" cy="12" r="3"/><circle cx="17" cy="12" r="3"/>',
  'nd-channels': '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="M12 13v8" stroke-dasharray="2 2"/>',
  'nd-harness': '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/><circle cx="20" cy="4" r="2"/>',
};

/** Lucide icon by name (kebab-case), or an ndea custom icon ('nd-*'). */
export function Icon({ name, size = 14, strokeWidth = 1.5, color = 'currentColor', title, style }) {
  const custom = CUSTOM_ICONS[name];
  const [svg, setSvg] = React.useState(custom ? null : CACHE[name] || null);
  React.useEffect(() => {
    if (custom) return undefined;
    if (CACHE[name]) { setSvg(CACHE[name]); return undefined; }
    let live = true;
    fetch(CDN + name + '.svg').then((r) => (r.ok ? r.text() : '')).then((t) => {
      const inner = t.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
      CACHE[name] = inner; if (live) setSvg(inner);
    }).catch(() => {});
    return () => { live = false; };
  }, [name]);
  const inner = (title ? '<title>' + title + '</title>' : '') + (custom || svg || '');
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} style={{ display: 'block', flex: 'none', ...style }} dangerouslySetInnerHTML={{ __html: inner }} />;
}
