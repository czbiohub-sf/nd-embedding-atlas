import React from 'react';

export function Checkbox({ checked = false, indeterminate = false, onChange, label, style }) {
  const on = checked || indeterminate;
  const box = <span role="checkbox" aria-checked={indeterminate ? 'mixed' : checked} tabIndex={0} onClick={(e) => onChange && onChange(!checked, e)} onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); onChange && onChange(!checked, e); } }}
    style={{ width: 13, height: 13, flex: 'none', borderRadius: 'var(--radius-xs)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, lineHeight: 1, cursor: 'pointer', color: 'var(--primary-foreground)', background: on ? 'var(--primary)' : 'transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1.5px var(--line-3)', transition: 'background-color var(--dur-fast) var(--ease-standard)' }}>{indeterminate ? '–' : checked ? '✓' : ''}</span>;
  if (!label) return <span style={style}>{box}</span>;
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 'var(--text-ui)', cursor: 'pointer', ...style }}>{box}{label}</label>;
}
