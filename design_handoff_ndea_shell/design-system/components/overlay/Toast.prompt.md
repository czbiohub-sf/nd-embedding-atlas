shadcn-style notification, stacked bottom-right; title states what happened, description gives the count or target.
```jsx
<Toaster toasts={[{id:1,title:'Opened cpg0016 · batch 7',description:'48,312 cells'}]} onDismiss={dismiss} />
```
- Auto-dismiss after ~4s. No marketing copy; exact counts.
