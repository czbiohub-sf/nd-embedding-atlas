⌘K window: switch layouts and collections by default, ">" for commands; keyboard ↑↓ ↵ esc. Render inside a positioned shell.
```jsx
<CommandMenu groups={[{heading:'Layouts',items:[{label:'Exploration',current:true}]}]} commands={[{label:'Add empty slot'}]} preview={(it)=> it && <span>{it.label}</span>} onClose={close} />
```
- Centered with margins (not translate) so the open animation never shifts it sideways.
