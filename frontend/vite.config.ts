import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        proxy: {
            "/data": "http://localhost:5055",
            "/api": "http://localhost:5055",
            "/plate": "http://localhost:5055",
        },
    },
    build: {
        outDir: "dist",
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules")) {
                        if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
                        if (/[\\/]@idetik[\\/]/.test(id)) return "vendor-idetik";
                        if (/[\\/](@uwdata|mosaic)[\\/]/.test(id)) return "vendor-mosaic";
                        if (/[\\/]dockview[\\/]/.test(id)) return "vendor-dockview";
                        if (/[\\/]embedding-atlas[\\/]/.test(id)) return "vendor-embedding-atlas";
                        if (/[\\/]apache-arrow[\\/]/.test(id)) return "vendor-arrow";
                    }
                },
            },
        },
    },
});
