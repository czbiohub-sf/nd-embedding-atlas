import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function Input({ value, onChange, placeholder, mono = false, icon, width, autoFocus, onKeyDown, style }) {
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--muted)', color: 'var(--foreground)', width, boxSizing: 'border-box', ...style }}>
    {icon ? <Icon name={icon} size={12} color="var(--text-muted)" /> : null}
    <input value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} autoFocus={autoFocus}
      style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 'var(--text-ui-sm)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', padding: 0 }} />
  </label>;
}
