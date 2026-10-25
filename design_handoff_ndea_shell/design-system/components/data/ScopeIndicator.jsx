import React from 'react';
import { Icon } from '../core/Icon.jsx';
/** Tile-header button for linked scopes: nd-scopes icon + one dot per scope. Pair with a Popover listing ScopeRows. */
export function ScopeIndicator({ scopes = [], active = false, onClick, onHover }) {
  const [h, setH] = React.useState(false);
  return <button type="button" title={'Linked: ' + scopes.map((s) => s.key).join(', ')} onClick={onClick} onMouseEnter={() => { setH(true); onHover && onHover(true); }} onMouseLeave={() => { setH(false); onHover && onHover(false); }}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 4px', border: 0, borderRadius: 'var(--radius-xs)', cursor: 'pointer', color: active || h ? 'var(--foreground)' : 'var(--text-muted)', background: active || h ? 'var(--muted)' : 'transparent' }}>
    <Icon name="nd-scopes" size={13} />
    <span style={{ display: 'flex', gap: 2 }}>{scopes.map((s) => <span key={s.key} style={{ width: 4, height: 4, borderRadius: 2, background: s.color }} />)}</span>
  </button>;
}
export function ScopeRow({ name, scopeKey, color, value, members, onUnlink, onHover }) {
  const [h, setH] = React.useState(false);
  return <div onMouseEnter={() => { setH(true); onHover && onHover(true); }} onMouseLeave={() => { setH(false); onHover && onHover(false); }} style={{ display: 'grid', gridTemplateColumns: '10px minmax(0,1fr) auto', gap: '2px 8px', alignItems: 'center', padding: '7px 6px', borderRadius: 'var(--radius-lg)', background: h ? 'var(--muted)' : 'transparent' }}>
    <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
    <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}><span style={{ fontWeight: 'var(--weight-medium)' }}>{name}</span><span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{scopeKey}</span></span>
    {onUnlink ? <button onClick={onUnlink} style={{ padding: '2px 7px', border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', font: 'inherit', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>Unlink</button> : <span />}
    <span /><span style={{ gridColumn: '2/4', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    <span /><span style={{ gridColumn: '2/4', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.4 }}>{members}</span>
  </div>;
}
