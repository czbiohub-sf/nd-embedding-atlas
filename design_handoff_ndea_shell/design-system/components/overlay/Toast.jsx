import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function Toast({ title, description, onClose, tone = 'default', style }) {
  return <li style={{ listStyle: 'none', pointerEvents: 'auto', position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 36px 14px 16px', borderRadius: 'var(--radius)', background: 'var(--card)', color: 'var(--card-foreground)', boxShadow: 'var(--shadow-toast)', animation: 'nd-toast 260ms var(--ease-toast)', ...style }}>
    {tone !== 'default' ? <span style={{ width: 8, height: 8, marginTop: 5, borderRadius: 4, flex: 'none', background: tone === 'error' ? 'var(--destructive)' : tone === 'success' ? 'var(--success)' : 'var(--dirty)' }} /> : null}
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-medium)', lineHeight: 1.35 }}>{title}</span>
      {description ? <span style={{ fontSize: 'var(--text-ui)', color: 'var(--text-muted)', lineHeight: 1.4 }}>{description}</span> : null}
    </div>
    {onClose ? <button onClick={onClose} aria-label="Dismiss" style={{ position: 'absolute', right: 8, top: 8, display: 'flex', padding: 4, border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}><Icon name="x" size={12} /></button> : null}
  </li>;
}

/** Bottom-right stack, 356px wide, newest at the bottom. */
export function Toaster({ toasts = [], onDismiss, style }) {
  return <ol style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 70, margin: 0, padding: 0, width: 356, maxWidth: 'calc(100% - 32px)', display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none', ...style }}>
    {toasts.map((t) => <Toast key={t.id} title={t.title} description={t.description} tone={t.tone} onClose={onDismiss ? () => onDismiss(t.id) : undefined} />)}
  </ol>;
}
