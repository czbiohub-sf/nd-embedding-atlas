import React from 'react';
/** Scatter legend card. Categorical rows filter on click; continuous shows a viridis bar with min/max. */
export function Legend({ title, mode = 'categorical', items = [], min, max, onToggle, onClear, hasFilter = false, style }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 4, minWidth: 160, borderRadius: 'var(--radius-lg)', background: 'var(--card)', boxShadow: 'var(--shadow-popover)', animation: 'nd-in var(--dur-fast) var(--ease-out)', ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px 4px' }}><span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{title}</span>
      {hasFilter && onClear ? <button onClick={onClear} style={{ border: 0, background: 'transparent', color: 'var(--primary)', font: 'inherit', fontSize: 'var(--text-sm)', cursor: 'pointer', padding: 0 }}>Clear</button> : null}</div>
    {mode === 'continuous' ? <div style={{ padding: '2px 6px 6px' }}><div style={{ height: 8, borderRadius: 4, background: 'var(--viridis)' }} /><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}><span>{min}</span><span>{max}</span></div></div>
      : items.map((it) => <button key={it.label} onClick={() => onToggle && onToggle(it.label)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 6px', border: 0, borderRadius: 'var(--radius-sm)', font: 'inherit', fontSize: 'var(--text-ui)', textAlign: 'left', cursor: 'pointer', color: 'var(--foreground)', background: it.active ? 'var(--muted)' : 'transparent', opacity: hasFilter && !it.active ? 0.45 : 1, transition: 'opacity var(--dur) var(--ease-standard)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: it.color }} /><span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
        {it.count != null ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', paddingLeft: 6 }}>{it.count}</span> : null}</button>)}
  </div>;
}
