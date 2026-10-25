import React from 'react';
import { Icon } from './Icon.jsx';

export function IconButton({ icon, label, size = 13, active = false, onClick, children, style }) {
  const [h, setH] = React.useState(false);
  return <button type="button" title={label} aria-label={label} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: 4, border: 0, borderRadius: 'var(--radius-xs)', cursor: 'pointer', background: active || h ? 'var(--muted)' : 'transparent', color: active || h ? 'var(--foreground)' : 'var(--text-muted)', transition: 'background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)', ...style }}>
    <Icon name={icon} size={size} />{children}
  </button>;
}
