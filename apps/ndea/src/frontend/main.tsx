import { createRoot } from "react-dom/client";
import { roaringLibraryInitialize } from "roaring-wasm";
import App from "./App";
// eslint-disable-next-line import/no-unassigned-import
import "./app.css";

await roaringLibraryInitialize();

const element = document.getElementById("root");
if (element) {
  // StrictMode omitted: idetik-core's WebGL context cannot survive the
  // double-mount/unmount cycle.
  const root = createRoot(element);
  root.render(<App />);
  const teardown = () => root.unmount();
  window.addEventListener("pagehide", teardown, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(teardown);
}
