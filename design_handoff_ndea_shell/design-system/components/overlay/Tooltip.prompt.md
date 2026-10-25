Hover label for icon-only controls; same surface as popovers (card, keyline, shadow), small, 500ms delay, instant between neighbours.
```jsx
<Tooltip content="Tile settings"><IconButton icon="settings" label="Tile settings" /></Tooltip>
```
- Content is a few words plus a shortcut. Never put actions inside.
- In plain-HTML pages, a delegated handler can turn every `title` into this tooltip (see ndea Shell).
