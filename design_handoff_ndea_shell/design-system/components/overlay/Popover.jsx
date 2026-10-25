import React from 'react';

/** Floating card for menus, legends, filter builders and settings. Position it yourself (absolute) or pass x/y. */
export function Popover({ title, meta, footer, width = 'var(--popover-width)', maxHeight, x, y, onClose, children, style }) {
  const card = <div role="dialog" style={{ position: x != null ? 'absolute' : 'relative', left: x, top: y, zIndex: 56, width, maxHeight, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: 'var(--card)', color: 'var(--card-foreground)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-popover)', overflow: 'hidden', animation: 'nd-in var(--dur-fast) var(--ease-out)', ...style }}>
    {title ? <div style={{ flex: 'none', display: 'flex', alignItems: 'baseline', gap: 6, padding: '10px 12px 6px' }}><span style={{ fontWeight: 'var(--weight-semibold)' }}>{title}</span>{meta ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span> : null}</div> : null}
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: title ? '0 6px 6px' : 6 }}>{children}</div>
    {footer ? <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderTop: 'var(--keyline) solid var(--border)' }}>{footer}</div> : null}
  </div>;
  if (!onClose) return card;
  return <>{<div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />}{card}</>;
}
