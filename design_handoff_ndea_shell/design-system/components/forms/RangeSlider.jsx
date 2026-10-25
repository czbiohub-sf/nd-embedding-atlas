import React from 'react';

/** Contrast-limit range over an intensity histogram (napari style). low/high are 0..1. */
export function RangeSlider({ low = 0.05, high = 0.75, onChange, histogram = [], color = 'var(--d1)', format = (x) => Math.round(x * 4095).toLocaleString('en-US'), width = '100%' }) {
  const ref = React.useRef(null);
  const drag = (which) => (e) => {
    e.preventDefault(); const r = ref.current.getBoundingClientRect();
    const mv = (ev) => { const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)); if (!onChange) return; if (which === 'lo') onChange(Math.min(x, high - 0.01), high); else onChange(low, Math.max(x, low + 0.01)); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const mx = Math.max(1, ...histogram);
  const thumb = (pos, which) => <span onPointerDown={drag(which)} style={{ position: 'absolute', left: 'calc(' + pos * 100 + '% - 5px)', bottom: -4, width: 10, height: 10, borderRadius: 5, background: 'var(--foreground)', boxShadow: '0 0 0 2px var(--surface)', cursor: 'ew-resize', touchAction: 'none' }} />;
  return <div style={{ width, display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div ref={ref} style={{ position: 'relative', height: 28 }}>
      <div style={{ position: 'absolute', inset: '0 0 4px 0', display: 'flex', alignItems: 'flex-end', gap: 1 }}>
        {histogram.map((v, i) => { const x = i / histogram.length, inR = x >= low && x <= high; return <span key={i} style={{ flex: 1, height: Math.max(1, (v / mx) * 100) + '%', background: inR ? color : 'var(--muted-2)', opacity: inR ? 0.75 : 1, borderRadius: 1 }} />; })}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--muted-2)', borderRadius: 1 }} />
      <div style={{ position: 'absolute', left: low * 100 + '%', width: (high - low) * 100 + '%', bottom: 0, height: 2, background: color }} />
      {thumb(low, 'lo')}{thumb(high, 'hi')}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}><span>{format(low)}</span><span>{format(high)}</span></div>
  </div>;
}
