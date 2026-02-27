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
                advancedChunks: {
                    groups: [
                        {
                            name: "vendor-react",
                            test: /node_modules[\\/]+(react|react-dom|scheduler)/,
                            priority: 20,
                        },
                        {
                            name: "vendor-idetik",
                            test: /node_modules[\\/]+@idetik/,
                            priority: 15,
                        },
                        {
                            name: "vendor-mosaic",
                            test: /node_modules[\\/]+(@uwdata|mosaic)/,
                            priority: 15,
                        },
                        {
                            name: "vendor-dockview",
                            test: /node_modules[\\/]+dockview/,
                            priority: 15,
                        },
                        {
                            name: "vendor-embedding-atlas",
                            test: /node_modules[\\/]+embedding-atlas/,
                            priority: 15,
                        },
                        {
                            name: "vendor-arrow",
                            test: /node_modules[\\/]+apache-arrow/,
                            priority: 10,
                        },
                    ],
                },
            },
        },
    },
});
