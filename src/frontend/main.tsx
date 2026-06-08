import { createRoot } from "react-dom/client";
import { roaringLibraryInitialize } from "roaring-wasm";
import App from "./App";
// eslint-disable-next-line import/no-unassigned-import
import "./app.css";

// roaring-wasm WASM init — must complete before any broadcast path runs.
// top-level await is safe: build.target is already 'esnext' in vite.config.ts
await roaringLibraryInitialize();

// StrictMode omitted — idetik-core's WebGL context cannot survive
// the double-mount/unmount cycle (canvas.getContext returns the same
// context, but Idetik's stop() may invalidate internal state).
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
