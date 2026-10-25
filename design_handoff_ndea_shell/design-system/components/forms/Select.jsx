import React from 'react';
import { Icon } from '../core/Icon.jsx';

/** In-theme dropdown (replaces the native OS select): muted trigger + floating listbox with check, meta column and keyboard nav. */
export function Select({ value, onChange, options = [], mono = false, width, placeholder = 'Select', style }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const [open, setOpen] = React.useState(false); const [sel, setSel] = React.useState(0); const [up, setUp] = React.useState(false);
  const ref = React.useRef(null); const cur = opts.find((o) => o.value === value);
  const pick = (o) => { setOpen(false); onChange && onChange({ target: { value: o.value } }, o.value); };
  const toggle = () => { if (!open) { const r = ref.current.getBoundingClientRect(); setUp(window.innerHeight - r.bottom < Math.min(320, opts.length * 28 + 10) && r.top > window.innerHeight - r.bottom); setSel(Math.max(0, opts.findIndex((o) => o.value === value))); } setOpen(!open); };
  React.useEffect(() => { if (!open) return undefined; const k = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length); } else if (e.key === 'Enter') { e.preventDefault(); const o = opts[sel]; if (o) pick(o); } }; document.addEventListener('keydown', k, true); return () => document.removeEventListener('keydown', k, true); });
  return <span ref={ref} style={{ position: 'relative', display: 'inline-flex', width, ...style }}>
    <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={toggle} style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '3px 7px', border: 0, borderRadius: 'var(--radius-sm)', background: open ? 'var(--muted-2)' : 'var(--muted)', color: 'var(--foreground)', font: 'inherit', fontSize: mono ? 'var(--text-sm)' : 'var(--text-ui-sm)', fontFamily: mono ? 'var(--font-mono)' : 'inherit', whiteSpace: 'nowrap', cursor: 'pointer' }}>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', color: cur ? 'inherit' : 'var(--text-muted)' }}>{cur ? cur.label : placeholder}</span>
      <Icon name="chevron-down" size={11} color="var(--text-muted)" />
    </button>
    {open ? <>
      <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 58 }} />
      <div role="listbox" style={{ position: 'absolute', left: 0, [up ? 'bottom' : 'top']: 'calc(100% + 4px)', zIndex: 59, minWidth: '100%', maxWidth: 280, maxHeight: 320, overflow: 'auto', boxSizing: 'border-box', padding: 4, display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-popover)', animation: 'nd-in var(--dur-fast) var(--ease-out)' }}>
        {opts.map((o, i) => <button key={o.value} type="button" role="option" aria-selected={o.value === value} onClick={() => pick(o)} onMouseEnter={() => setSel(i)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '5px 8px', boxSizing: 'border-box', border: 0, borderRadius: 'var(--radius-sm)', background: i === sel ? 'var(--muted)' : 'transparent', color: 'var(--foreground)', font: 'inherit', fontSize: 'var(--text-ui-sm)', textAlign: 'left', cursor: 'pointer' }}>
          <span style={{ width: 12, flex: 'none', display: 'flex' }}>{o.value === value ? <Icon name="check" size={12} color="var(--primary)" strokeWidth={2.2} /> : null}</span>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{o.label}</span>
          {o.meta ? <span style={{ flex: 'none', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{o.meta}</span> : null}
        </button>)}
      </div>
    </> : null}
  </span>;
}
