import { createRoot } from "react-dom/client";
import { roaringLibraryInitialize } from "roaring-wasm";
import App from "./App";
import { bootFrontend, loadFrontendPluginSession } from "./core/plugin/runtime";
// eslint-disable-next-line import/no-unassigned-import
import "./app.css";

const boot = await bootFrontend({
  loadSession: loadFrontendPluginSession,
  initializeRoaring: roaringLibraryInitialize,
  mount(session) {
    const element = document.getElementById("root");
    if (!element) return;

    // StrictMode omitted — idetik-core's WebGL context cannot survive the
    // double-mount/unmount cycle.
    const root = createRoot(element);
    root.render(<App nodeLibrary={session.nodeLibrary} />);
    return () => root.unmount();
  },
});

const teardown = () => {
  window.removeEventListener("pagehide", teardown);
  boot.dispose();
};
window.addEventListener("pagehide", teardown, { once: true });
if (import.meta.hot) import.meta.hot.dispose(teardown);
