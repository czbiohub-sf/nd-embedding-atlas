The app's only chrome: a 32px icon rail at the left edge whose tabs open a flyout panel over the tiles.
```jsx
<SidebarRail items={[{id:'layouts',icon:'layout-grid',label:'Layouts',active:true},{id:'data',icon:'database',label:'Data'}]} footer={[{id:'settings',icon:'settings-2',label:'Settings'}]} flyout={<LayoutsList/>} flyoutTitle="Layouts" />
```
- Flyouts overlay; they never push tiles. Vertical space beats horizontal.
