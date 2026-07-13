import { createRoot } from "react-dom/client";
import { roaringLibraryInitialize } from "roaring-wasm";
import App from "./App";
import { registerBuiltins } from "./core/workspace/definitions";
// eslint-disable-next-line import/no-unassigned-import
import "./app.css";

// roaring-wasm WASM init — must complete before any broadcast path runs.
// top-level await is safe: build.target is already 'esnext' in vite.config.ts
await roaringLibraryInitialize();

// Register plugin metadata once at boot, before React renders — shell-agnostic
// so the node workspace stands on its own. Engine code stays lazy (each
// descriptor's Component is behind `load() => import()`). Idempotent.
registerBuiltins();

// StrictMode omitted — idetik-core's WebGL context cannot survive
// the double-mount/unmount cycle (canvas.getContext returns the same
// context, but Idetik's stop() may invalidate internal state).
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
