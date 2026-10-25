import React from 'react';
import { Icon } from './Icon.jsx';

/** Button that floats over a canvas (scatter, image). Same look alone or inside an OverlayGroup. */
export function OverlayButton({ icon, label, active = false, grouped = false, onClick, children, style }) {
  const [h, setH] = React.useState(false);
  const bg = active || h ? 'var(--muted)' : grouped ? 'transparent' : 'var(--overlay)';
  return <button type="button" title={label} aria-label={label} aria-pressed={active} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: 5, border: 0, cursor: 'pointer', borderRadius: 'var(--radius)', background: bg, boxShadow: grouped ? 'none' : 'var(--edge)', color: active || h || !grouped ? 'var(--foreground)' : 'var(--text-muted)', transition: 'background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)', ...style }}>
    <Icon name={icon} size={14} />{children}
  </button>;
}

/** Pill of OverlayButtons split into sections by separators (shadcn ButtonGroup), e.g. the embedding strip: tools | legend. */
export function OverlayGroup({ items = [], value, onChange, direction = 'column', style }) {
  return <div role="toolbar" style={{ display: 'inline-flex', flexDirection: direction, gap: 2, padding: 2, borderRadius: 'var(--radius-xl)', background: 'var(--overlay)', boxShadow: 'var(--edge)', ...style }}>
    {items.map((it, i) => (it.separator ? <span key={'sep' + i} style={{ alignSelf: 'stretch', [direction === 'column' ? 'height' : 'width']: 1, margin: direction === 'column' ? '1px 3px' : '3px 1px', background: 'var(--border)' }} /> : <OverlayButton key={it.value} grouped icon={it.icon} label={it.label} active={it.action ? !!it.active : it.value === value} onClick={() => (it.onClick ? it.onClick() : onChange && onChange(it.value))} />))}
  </div>;
}
