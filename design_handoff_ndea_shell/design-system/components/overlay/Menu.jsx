import React from 'react';
import { Icon } from '../core/Icon.jsx';

function Item({ it, onSelect }) {
  const [h, setH] = React.useState(false);
  return <button role="menuitem" onClick={() => { it.onSelect && it.onSelect(); onSelect && onSelect(it); }} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', boxSizing: 'border-box', border: 0, borderRadius: 'var(--radius-md)', font: 'inherit', fontSize: 'var(--text-ui)', textAlign: 'left', cursor: 'pointer', background: h ? 'var(--muted)' : 'transparent', color: it.danger ? 'var(--destructive)' : 'var(--foreground)' }}>
    {it.icon ? <Icon name={it.icon} size={13} color={it.danger ? 'var(--destructive)' : 'var(--text-muted)'} /> : null}
    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
    {it.hint ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>{it.hint}</span> : null}
    {it.checked ? <Icon name="check" size={13} color="var(--primary)" /> : null}
  </button>;
}

/** Vertical list of actions or choices; place inside a Popover. */
export function Menu({ items = [], onSelect, style }) {
  return <div role="menu" style={{ display: 'flex', flexDirection: 'column', gap: 1, ...style }}>
    {items.map((it, i) => (it.separator ? <span key={'s' + i} style={{ height: 'var(--keyline)', margin: '4px 6px', background: 'var(--border)' }} /> : it.heading ? <div key={'h' + i} style={{ padding: '8px 8px 3px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{it.heading}</div> : <Item key={it.label + i} it={it} onSelect={onSelect} />))}
  </div>;
}
