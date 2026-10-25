import React from 'react';
import { Icon } from './Icon.jsx';

const V = {
  primary: { bg: 'var(--primary)', fg: 'var(--primary-foreground)', hover: { opacity: 0.85 } },
  secondary: { bg: 'var(--muted)', fg: 'var(--foreground)', hover: { background: 'var(--muted-2)' } },
  accent: { bg: 'var(--accent)', fg: 'var(--accent-foreground)', hover: { opacity: 0.85 } },
  ghost: { bg: 'transparent', fg: 'var(--text-muted)', hover: { background: 'var(--muted)', color: 'var(--foreground)' } },
  destructive: { bg: 'var(--destructive-bg)', fg: 'var(--destructive)', hover: { opacity: 0.85 } },
};
const S = { sm: { padding: '3px 7px', fontSize: 'var(--text-ui-sm)', gap: 4 }, md: { padding: '5px 10px', fontSize: 'var(--text-ui-lg)', gap: 6 } };

export function Button({ variant = 'secondary', size = 'sm', icon, iconRight, active = false, disabled = false, onClick, title, children, style }) {
  const [h, setH] = React.useState(false);
  const v = V[variant] || V.secondary, s = S[size] || S.sm;
  const base = { display: 'inline-flex', alignItems: 'center', gap: s.gap, padding: s.padding, fontSize: s.fontSize, fontFamily: 'inherit', lineHeight: 1.3, whiteSpace: 'nowrap', border: 0, cursor: disabled ? 'default' : 'pointer', borderRadius: 'var(--radius-sm)', background: active && variant === 'ghost' ? 'var(--accent)' : v.bg, color: active && variant === 'ghost' ? 'var(--accent-foreground)' : v.fg, opacity: disabled ? 0.45 : 1, transition: 'background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), opacity var(--dur-fast) var(--ease-standard)' };
  return <button type="button" title={title} disabled={disabled} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ ...base, ...(h && !disabled && !active ? v.hover : null), ...style }}>
    {icon ? <Icon name={icon} size={13} /> : null}{children}{iconRight ? <Icon name={iconRight} size={12} /> : null}
  </button>;
}
