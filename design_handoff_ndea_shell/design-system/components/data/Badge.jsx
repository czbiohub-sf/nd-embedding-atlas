import React from 'react';
const T = { default: ['var(--muted)', 'var(--text-muted)'], accent: ['var(--accent)', 'var(--accent-foreground)'], primary: ['var(--primary)', 'var(--primary-foreground)'], destructive: ['var(--destructive-bg)', 'var(--destructive)'], outline: ['transparent', 'var(--text-muted)'] };
export function Badge({ tone = 'default', mono = false, children, style }) {
  const [bg, fg] = T[tone] || T.default;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px', height: 18, borderRadius: 'var(--radius-pill)', background: bg, color: fg, boxShadow: tone === 'outline' ? 'inset 0 0 0 1px var(--line-2)' : 'none', fontSize: 'var(--text-xs)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', whiteSpace: 'nowrap', ...style }}>{children}</span>;
}
