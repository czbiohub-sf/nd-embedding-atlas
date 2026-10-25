Observation table with type glyphs, provenance markers (obs / saved / unsaved), dirty-cell bars, row selection and focus.
```jsx
<DataTable columns={[{key:'well',status:'obs'},{key:'phenotype',type:'label',status:'unsaved'}]} rows={rows} focusId={focus} onRowClick={(r)=>setFocus(r.id)} />
```
- Click focuses everywhere; shift-click selects a range; ⌘-click toggles.
