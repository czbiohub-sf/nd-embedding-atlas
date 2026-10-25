In-theme dropdown: muted trigger with chevron, floating listbox with a check on the current value and an optional meta column. Never use the native OS select.
```jsx
<Select mono value="PC1" options={['PC1','PC2','PC3']} onChange={(e,v)=>setX(v)} />
```
- ↑↓ to move, ↵ to pick, esc to close. Opens upward when there is no room below.
