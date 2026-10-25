import React from 'react';
import { Icon } from '../core/Icon.jsx';

function RailButton({ item, onSelect }) {
  const [h, setH] = React.useState(false);
  return <button title={item.label} aria-label={item.label} onClick={() => onSelect && onSelect(item.id)} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 26, border: 0, borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: item.active || h ? 'var(--foreground)' : 'var(--text-muted)', background: item.active ? 'var(--muted)' : h ? 'var(--soft)' : 'transparent', transition: 'background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)' }}>
    <Icon name={item.icon} size={14} />
    {item.dot ? <span style={{ position: 'absolute', right: 4, top: 4, width: 5, height: 5, borderRadius: 3, background: item.dot }} /> : null}
  </button>;
}

/** 32px icon rail pinned to the left edge; its flyout opens over the tiles, never pushing them. */
export function SidebarRail({ logo, items = [], footer = [], onSelect, flyout, flyoutTitle, onCloseFlyout, height = '100%', style }) {
  return <div style={{ position: 'relative', height, display: 'flex', ...style }}>
    <nav style={{ width: 'var(--rail-width)', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 3px', background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-tile)' }}>
      {logo ? <div style={{ display: 'flex', justifyContent: 'center', padding: '3px 0 6px' }}>{logo}</div> : null}
      {items.map((it) => (it.separator ? <span key={it.id} style={{ height: 1, margin: '4px 4px', background: 'var(--border)' }} /> : <RailButton key={it.id} item={it} onSelect={onSelect} />))}
      <span style={{ flex: 1 }} />
      {footer.map((it) => <RailButton key={it.id} item={it} onSelect={onSelect} />)}
    </nav>
    {flyout ? <aside style={{ position: 'absolute', left: 'calc(var(--rail-width) + var(--gutter))', top: 0, bottom: 0, zIndex: 20, width: 'var(--flyout-width)', display: 'flex', flexDirection: 'column', background: 'var(--card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-popover)', animation: 'nd-in var(--dur) var(--ease-out)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 10px 6px 12px' }}><span style={{ flex: 1, fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-md)' }}>{flyoutTitle}</span>
        {onCloseFlyout ? <button onClick={onCloseFlyout} aria-label="Close" style={{ display: 'flex', padding: 4, border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-xs)' }}><Icon name="x" size={13} /></button> : null}</div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 6px 8px' }}>{flyout}</div>
    </aside> : null}
  </div>;
}
