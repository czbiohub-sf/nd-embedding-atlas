import React from 'react';
/** Category/label value chip with a color dot. selected = filled accent; empty = dashed "add" placeholder. */
export function Pill({ label, color, count, selected = false, empty = false, onClick, style }) {
  const [h, setH] = React.useState(false);
  return <button type="button" onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px ' + (color ? 6 : 8) + 'px', border: 0, borderRadius: 'var(--radius-pill)', font: 'inherit', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default', background: selected ? 'var(--accent)' : empty ? 'transparent' : 'var(--muted)', color: selected ? 'var(--accent-foreground)' : empty ? 'var(--text-muted)' : 'var(--foreground)', boxShadow: empty ? 'inset 0 0 0 1px ' + (h ? 'var(--text-muted)' : 'var(--line-2)') : h && onClick ? 'inset 0 0 0 1px var(--line-3)' : 'none', transition: 'background-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)', ...style }}>
    {color ? <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flex: 'none' }} /> : null}{empty ? label || 'add' : label}
    {count != null ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{count}</span> : null}
  </button>;
}
