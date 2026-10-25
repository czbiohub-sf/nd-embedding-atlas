import React from 'react';
import { Checkbox } from '../forms/Checkbox.jsx';
import { Pill } from './Pill.jsx';

const GLYPH = { text: 'Aa', number: '#', category: '◉', label: '◇', checkbox: '☑' };
/** Airtable-lite table. Columns carry provenance: obs (from file, read-only), saved, unsaved. Dirty cells get a left amber bar. */
export function DataTable({ columns = [], rows = [], focusId, onRowClick, selectable = true, selected = [], onSelect, showOld = false, summaries, style }) {
  const all = rows.length && selected.length >= rows.length;
  const st = (s) => (s === 'saved' ? { background: 'var(--text-muted)' } : s === 'unsaved' ? { boxShadow: 'inset 0 0 0 1.5px var(--dirty)' } : null);
  return <div style={{ overflow: 'auto', ...style }}>
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
      <thead><tr>
        {selectable ? <th style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', width: 44, padding: '3px 6px', textAlign: 'left', borderBottom: 'var(--keyline) solid var(--border)' }}><Checkbox checked={!!all} indeterminate={!all && selected.length > 0} onChange={() => onSelect && onSelect(all || selected.length ? [] : rows.map((r) => r.id))} /></th> : null}
        {columns.map((c) => <th key={c.key} title={c.status === 'obs' ? 'From obs in the file · read-only' : c.status === 'saved' ? 'Saved annotation field' : c.status === 'unsaved' ? 'Unsaved' : undefined}
          style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)', textAlign: c.type === 'number' ? 'right' : 'left', fontWeight: 400, padding: '4px 8px', whiteSpace: 'nowrap', color: 'var(--text-muted)', borderBottom: 'var(--keyline) solid var(--border)', borderLeft: '1px solid var(--muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ fontFamily: 'var(--font-sans)', fontSize: 9.5, fontWeight: 'var(--weight-semibold)' }}>{GLYPH[c.type] || 'Aa'}</span>{c.label || c.key}{st(c.status) ? <span style={{ width: 6, height: 6, borderRadius: 3, ...st(c.status) }} /> : null}</span></th>)}
      </tr></thead>
      <tbody>{rows.map((r, i) => { const on = selected.includes(r.id), foc = r.id === focusId; return <tr key={r.id} onClick={(e) => onRowClick && onRowClick(r, e)} style={{ cursor: 'pointer', background: foc ? 'var(--accent)' : 'transparent', transition: 'background-color var(--dur) var(--ease-standard)' }}>
        {selectable ? <td style={{ padding: '3px 6px', color: 'var(--text-muted)', borderBottom: '1px solid var(--muted)' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Checkbox checked={on} onChange={() => onSelect && onSelect(on ? selected.filter((x) => x !== r.id) : selected.concat([r.id]))} /><span style={{ fontSize: 'var(--text-2xs)' }}>{i + 1}</span></span></td> : null}
        {columns.map((c) => { const v = r.cells[c.key], d = r.dirty && r.dirty[c.key]; return <td key={c.key} style={{ padding: '3px 8px', whiteSpace: 'nowrap', textAlign: c.type === 'number' ? 'right' : 'left', borderBottom: '1px solid var(--muted)', borderLeft: '1px solid var(--muted)', boxShadow: d ? 'inset 2px 0 0 var(--dirty)' : 'none', color: foc ? 'var(--accent-foreground)' : 'var(--foreground)' }}>
          {showOld && d ? <span style={{ marginRight: 6, color: 'var(--text-muted)', textDecoration: 'line-through', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)' }}>{d.old || 'empty'}</span> : null}
          {c.type === 'category' || c.type === 'label' ? (v ? <Pill label={v.label || v} color={v.color} /> : c.type === 'label' ? <Pill empty /> : null) : c.type === 'checkbox' ? <Checkbox checked={!!v} /> : v}
        </td>; })}
      </tr>; })}</tbody>
      {summaries ? <tfoot><tr>{selectable ? <td style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', borderTop: 'var(--keyline) solid var(--border)' }} /> : null}{columns.map((c) => <td key={c.key} style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', padding: '4px 8px', borderTop: 'var(--keyline) solid var(--border)', color: 'var(--text-muted)', fontSize: 'var(--text-2xs)', whiteSpace: 'nowrap', textAlign: c.type === 'number' ? 'right' : 'left' }}>{summaries[c.key]}</td>)}</tr></tfoot> : null}
    </table>
  </div>;
}
