import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";

// StrictMode omitted — idetik-core's WebGL context cannot survive
// the double-mount/unmount cycle (canvas.getContext returns the same
// context, but Idetik's stop() may invalidate internal state).
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
