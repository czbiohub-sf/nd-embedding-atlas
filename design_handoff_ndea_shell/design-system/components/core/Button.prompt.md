Text button for toolbars, popover footers and review actions; ghost is the default tool button inside tiles.
```jsx
<Button variant="ghost" active>Filter · 2</Button>
<Button variant="primary">Save</Button>
```
- One primary per surface. Discard uses destructive or ghost.
- `active` on ghost buttons marks an applied sort/filter/group.
