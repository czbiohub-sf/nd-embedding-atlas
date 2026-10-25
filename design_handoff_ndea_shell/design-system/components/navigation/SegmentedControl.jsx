import React from 'react';

/** Muted track with a raised thumb that slides to the selected option. */
export function SegmentedControl({ options = [], value, onChange, size = 'sm', style }) {
  const refs = React.useRef({}); const [th, setTh] = React.useState(null);
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  React.useLayoutEffect(() => { const el = refs.current[value]; if (el) setTh({ left: el.offsetLeft, width: el.offsetWidth }); }, [value, options.length]);
  const pad = size === 'md' ? '4px 12px' : '3px 9px', fs = size === 'md' ? 'var(--text-ui)' : 'var(--text-ui-sm)';
  return <div role="radiogroup" style={{ position: 'relative', display: 'inline-flex', gap: 1, padding: 2, borderRadius: 'var(--radius-md)', background: 'var(--muted)', ...style }}>
    {th ? <span style={{ position: 'absolute', top: 2, bottom: 2, left: th.left, width: th.width, borderRadius: 'var(--radius-sm)', background: 'var(--card)', boxShadow: 'var(--shadow-raised)', transition: 'left var(--dur) var(--ease-out), width var(--dur) var(--ease-out)' }} /> : null}
    {opts.map((o) => { const on = o.value === value; return <button key={o.value} ref={(el) => { refs.current[o.value] = el; }} role="radio" aria-checked={on} title={o.title} onClick={() => onChange && onChange(o.value)}
      style={{ position: 'relative', zIndex: 1, padding: pad, border: 0, background: 'transparent', borderRadius: 'var(--radius-sm)', font: 'inherit', fontSize: fs, whiteSpace: 'nowrap', cursor: 'pointer', color: on ? 'var(--foreground)' : 'var(--text-muted)', transition: 'color var(--dur-fast) var(--ease-standard)' }}>{o.label}</button>; })}
  </div>;
}
