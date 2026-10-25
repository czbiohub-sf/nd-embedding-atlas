import React from 'react';
import { Kbd } from '../data/Kbd.jsx';

/** ⌘K: centered window for switching layouts and collections; type ">" for commands. Fixed width; optional preview pane. */
export function CommandMenu({ open = true, onClose, groups = [], commands = [], placeholder = 'Switch layout or dataset…  type > for commands', preview, width = 760 }) {
  const [q, setQ] = React.useState(''); const [sel, setSel] = React.useState(0);
  const isCmd = q.startsWith('>'), qq = (isCmd ? q.slice(1) : q).trim().toLowerCase();
  const src = isCmd ? [{ heading: 'Commands', items: commands }] : groups;
  const shown = src.map((g) => ({ ...g, items: (g.items || []).filter((it) => !qq || (it.label + ' ' + (it.sub || '')).toLowerCase().includes(qq)) })).filter((g) => g.items.length);
  const flat = shown.flatMap((g) => g.items), cur = flat[Math.min(sel, flat.length - 1)];
  React.useEffect(() => { setSel(0); }, [q]);
  if (!open) return null;
  const key = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } else if (e.key === 'Enter' && cur) { cur.onSelect && cur.onSelect(); onClose && onClose(); } else if (e.key === 'Escape') onClose && onClose(); };
  let n = -1;
  return <div style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)' }} />
    <div style={{ position: 'absolute', left: 0, right: 0, margin: '0 auto', top: '12%', width, maxWidth: 'calc(100% - 32px)', maxHeight: 'min(520px, 76%)', display: 'flex', flexDirection: 'column', background: 'var(--card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-popover)', overflow: 'hidden', animation: 'nd-in var(--dur-fast) var(--ease-out)' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderBottom: 'var(--keyline) solid var(--border)' }}>
        {isCmd ? <span style={{ padding: '1px 6px', borderRadius: 'var(--radius-xs)', background: 'var(--accent)', color: 'var(--accent-foreground)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>cmd</span> : null}
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder={placeholder} style={{ flex: 1, minWidth: 0, padding: '10px 0', border: 0, outline: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 'var(--text-lg)' }} />
        <Kbd>esc</Kbd>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: '2px 6px 8px' }}>
          {shown.map((g) => <div key={g.heading}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 10px 4px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}><span style={{ fontWeight: 'var(--weight-medium)' }}>{g.heading}</span><span>{g.meta}</span></div>
            {g.items.map((it) => { n++; const k = n, on = k === Math.min(sel, flat.length - 1); return <div key={it.label + k} onMouseMove={() => setSel(k)} onClick={() => { it.onSelect && it.onSelect(); onClose && onClose(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px ' + (10 + (it.depth || 0) * 18) + 'px', borderRadius: 'var(--radius-lg)', cursor: 'pointer', background: on ? 'var(--muted)' : 'transparent' }}>
              {it.leading || null}
              <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>{it.sub ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-ui-sm)', whiteSpace: 'nowrap' }}>{it.sub}</span> : null}</span>
              {it.current ? <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--primary)' }} /> : null}
              {it.meta ? <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{it.meta}</span> : null}
            </div>; })}
          </div>)}
          {!flat.length ? <div style={{ padding: '14px 10px', color: 'var(--text-muted)' }}>Nothing matches.</div> : null}
        </div>
        {preview ? <div style={{ width: 240, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderLeft: 'var(--keyline) solid var(--border)' }}>{preview(cur)}</div> : null}
      </div>
      <div style={{ flex: 'none', display: 'flex', gap: 14, padding: '7px 12px', borderTop: 'var(--keyline) solid var(--border)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}><span>↑↓ move</span><span>↵ open</span><span>{isCmd ? 'delete > to go back' : '> for commands'}</span></div>
    </div>
  </div>;
}
