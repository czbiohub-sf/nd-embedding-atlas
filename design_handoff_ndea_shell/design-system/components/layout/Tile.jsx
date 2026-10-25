import React from 'react';

/** Dashboard tile: rounded surface with a tile ring, compact header (title or Tabs, subtitle, actions) and a body. */
export function Tile({ title, subtitle, tabs, actions, highlighted = false, dimmed = false, padded = true, children, style, bodyStyle }) {
  return <section style={{ position: 'relative', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-tile)', outline: highlighted ? '1px solid var(--primary)' : '1px solid transparent', outlineOffset: 1, opacity: dimmed ? 0.4 : 1, transition: 'opacity var(--dur) var(--ease-standard), outline-color var(--dur) var(--ease-standard)', ...style }}>
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, minHeight: 'var(--tile-header)', padding: '0 6px 0 10px', boxSizing: 'border-box', overflow: 'hidden' }}>
      {tabs || <span style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-ui-lg)', whiteSpace: 'nowrap' }}>{title}</span>}
      {subtitle ? <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</span> : <span style={{ flex: 1 }} />}
      {actions ? <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 1 }}>{actions}</div> : null}
    </div>
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', padding: padded ? '0 6px 6px' : 0, ...bodyStyle }}>{children}</div>
  </section>;
}

/** Empty tile slot waiting for a component; opens the command menu. */
export function TileSlot({ onChoose, label = 'Choose a component', hint = '⌘K' }) {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: '1.5px dashed var(--line-2)' }}>
    <button onClick={onChoose} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 12px', margin: 8, textAlign: 'center', border: 0, borderRadius: 'var(--radius-md)', background: 'var(--primary)', color: 'var(--primary-foreground)', font: 'inherit', fontWeight: 'var(--weight-medium)', cursor: 'pointer' }}>{label}<span style={{ fontFamily: 'var(--font-mono)', opacity: 0.8 }}>{hint}</span></button>
  </div>;
}
