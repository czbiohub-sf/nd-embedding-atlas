import React from 'react';

/** shadcn-style tooltip in the popover surface (card + keyline + shadow), 500ms open delay, instant when moving between triggers within 300ms. Wrap any trigger. */
let warmUntil = 0;
export function Tooltip({ content, side = 'top', delay = 500, children }) {
  const ref = React.useRef(null); const [pos, setPos] = React.useState(null); const tm = React.useRef(0);
  const open = () => { clearTimeout(tm.current); tm.current = setTimeout(() => { const el = ref.current; if (!el) return; const b = el.getBoundingClientRect(); setPos({ x: b.left + b.width / 2, y: side === 'top' ? b.top - 6 : b.bottom + 6 }); }, Date.now() < warmUntil ? 0 : delay); };
  const close = () => { clearTimeout(tm.current); if (pos) warmUntil = Date.now() + 300; setPos(null); };
  React.useEffect(() => () => clearTimeout(tm.current), []);
  return <span ref={ref} onPointerEnter={open} onPointerLeave={close} onPointerDown={close} style={{ display: 'inline-flex' }}>
    {children}
    {pos && content ? <span role="tooltip" style={{ position: 'fixed', zIndex: 9999, left: pos.x, top: pos.y, transform: side === 'top' ? 'translate(-50%,-100%)' : 'translate(-50%,0)', pointerEvents: 'none', maxWidth: 240, padding: '5px 9px', borderRadius: 'var(--radius-md)', background: 'var(--card)', color: 'var(--foreground)', boxShadow: 'var(--shadow-popover)', fontSize: 'var(--text-ui-sm)', fontWeight: 'var(--weight-regular)', lineHeight: 1.35, whiteSpace: 'normal', animation: 'nd-in var(--dur-fast) var(--ease-out)' }}>{content}</span> : null}
  </span>;
}
