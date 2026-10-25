import React from 'react';
export function Kbd({ children, style }) {
  return <kbd style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 5px', borderRadius: 'var(--radius-xs)', background: 'var(--muted)', boxShadow: 'inset 0 -1px 0 var(--line-2)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.4, ...style }}>{children}</kbd>;
}
