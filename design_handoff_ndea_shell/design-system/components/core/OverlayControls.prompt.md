Controls that float over a canvas: a single OverlayButton (image Channels, scatter Legend) or an OverlayGroup (embedding tool strip). Both share the overlay fill, edge, 7px corner and muted active state.
```jsx
<OverlayButton icon="layers" label="Channels" active={open} />
<OverlayGroup items={[{value:'pointer',icon:'mouse-pointer-2',label:'Select · V'},{value:'box',icon:'square-dashed',label:'Box · B'},{value:'lasso',icon:'lasso',label:'Lasso · L'}]} value={tool} onChange={setTool} />
```
