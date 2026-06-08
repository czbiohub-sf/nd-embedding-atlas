# Vendored fonts

**Geist Pixel** (`GeistPixel-Square.woff2`, `GeistPixel-Grid.woff2`) — HUD signage face.
Source: Vercel Geist (github.com/vercel/geist-font / vercel.com/font). License: SIL OFL 1.1.
Vendored because the `geist` npm package only exposes Pixel via a `next/font` module
(unusable in this Vite+Bun app). Referenced by the `@font-face` in `src/frontend/app.css`.
