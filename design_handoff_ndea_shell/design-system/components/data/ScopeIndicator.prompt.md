Shows which shared scopes (filter, focus, color-by) a tile is linked to; opens a Popover of ScopeRows with Unlink.
```jsx
<ScopeIndicator scopes={[{key:'F1',color:'var(--scope-filter)'},{key:'FOCUS',color:'var(--scope-focus)'}]} onClick={open} />
<ScopeRow name="Filter" scopeKey="F1" color="var(--scope-filter)" value="treatment = Taxol" members="Embedding 1, Crops, Table" onUnlink={unlink} />
```
