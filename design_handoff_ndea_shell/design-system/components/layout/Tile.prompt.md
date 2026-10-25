The dashboard's unit: a surface with a 1.15px tile ring, a 30px header and a body; place in a CSS grid with 4px gaps.
```jsx
<Tile title="Crops" actions={<IconButton icon="settings-2" label="Tile settings" />}>{gallery}</Tile>
<Tile title="Empty slot"><TileSlot onChoose={openCmdk} /></Tile>
```
- Use `tabs={<Tabs …/>}` instead of title for stacked components.
- `padded={false}` for scatter and image canvases.
