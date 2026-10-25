import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** Tile tabs: several components stacked in one tile. Optional close and add. */
export function Tabs({ tabs = [], value, onChange, onClose, onAdd, style }) {
  const refs = React.useRef({}); const [th, setTh] = React.useState(null);
  React.useLayoutEffect(() => { const el = refs.current[value]; if (el) setTh({ left: el.offsetLeft, width: el.offsetWidth }); }, [value, tabs.length]);
  return <div role="tablist" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 1, padding: 2, borderRadius: 'var(--radius-md)', background: 'var(--muted)', minWidth: 0, ...style }}>
    {th ? <span style={{ position: 'absolute', top: 2, bottom: 2, left: th.left, width: th.width, borderRadius: 'var(--radius-sm)', background: 'var(--card)', boxShadow: 'var(--shadow-raised)', transition: 'left var(--dur) var(--ease-out), width var(--dur) var(--ease-out)' }} /> : null}
    {tabs.map((t) => { const on = t.value === value; return <button key={t.value} ref={(el) => { refs.current[t.value] = el; }} role="tab" aria-selected={on} onClick={() => onChange && onChange(t.value)}
      style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', border: 0, background: 'transparent', borderRadius: 'var(--radius-sm)', font: 'inherit', fontSize: 'var(--text-ui)', fontWeight: on ? 'var(--weight-medium)' : 'var(--weight-regular)', whiteSpace: 'nowrap', cursor: 'pointer', color: on ? 'var(--foreground)' : 'var(--text-muted)' }}>
      {t.icon ? <Icon name={t.icon} size={12} /> : null}{t.label}
      {onClose && on && tabs.length > 1 ? <span role="button" aria-label={'Close ' + t.label} onClick={(e) => { e.stopPropagation(); onClose(t.value); }} style={{ display: 'flex', marginRight: -3, color: 'var(--text-muted)' }}><Icon name="x" size={11} /></span> : null}
    </button>; })}
    {onAdd ? <button title="Add tab" onClick={onAdd} style={{ position: 'relative', zIndex: 1, display: 'flex', padding: '3px 5px', border: 0, background: 'transparent', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}><Icon name="plus" size={12} /></button> : null}
  </div>;
}
