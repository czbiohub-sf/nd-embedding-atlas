import { createRoot } from "react-dom/client";
import { roaringLibraryInitialize } from "roaring-wasm";
import App from "./App";
import { isSketchRoute, SketchViewer } from "./components/gallery/sketches/SketchViewer";
// eslint-disable-next-line import/no-unassigned-import
import "./app.css";

const isSketches = isSketchRoute();

// roaring-wasm WASM init — must complete before any broadcast path runs.
// top-level await is safe: build.target is already 'esnext' in vite.config.ts.
// Skip when rendering the sketch route — sketches don't touch broadcast paths
// and skipping init avoids hitting the backend during pure UI iteration.
if (!isSketches) {
  await roaringLibraryInitialize();
}

// StrictMode omitted — idetik-core's WebGL context cannot survive
// the double-mount/unmount cycle (canvas.getContext returns the same
// context, but Idetik's stop() may invalidate internal state).
const root = document.getElementById("root");
if (root) createRoot(root).render(isSketches ? <SketchViewer /> : <App />);
