import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import typegpuPlugin from 'unplugin-typegpu/vite';
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), tailwindcss(), typegpuPlugin({})],
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
        proxy: {
            "/data": "http://localhost:5055",
            "/api": "http://localhost:5055",
            "/plate": "http://localhost:5055",
        },
    },
    build: {
        outDir: "dist",
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: "vendor-react",
                            test: /node_modules[\\/]+(react|react-dom|scheduler)/,
                            priority: 30,
                        },
                        {
                            name: "vendor-typegpu",
                            test: /node_modules[\\/]+(typegpu|@typegpu)/,
                            priority: 25,
                        },
                        {
                            name: "vendor-mosaic",
                            test: /node_modules[\\/]+(@uwdata|mosaic)/,
                            priority: 25,
                        },
                        {
                            name: "vendor-dockview",
                            test: /node_modules[\\/]+dockview/,
                            priority: 25,
                        },
                        {
                            name: "vendor-idetik",
                            test: /node_modules[\\/]+@idetik/,
                            priority: 20,
                        },
                        {
                            name: "vendor-tanstack",
                            test: /node_modules[\\/]+@tanstack/,
                            priority: 20,
                        },
                        {
                            name: "vendor-arrow",
                            test: /node_modules[\\/]+(apache-arrow)/,
                            priority: 15,
                        },
                        {
                            name: "vendor-ui",
                            test: /node_modules[\\/]+(lucide-react|@base-ui|class-variance-authority|clsx|tailwind-merge|cmdk|@radix-ui)/,
                            priority: 10,
                        },
                        {
                            name: "vendor-misc",
                            test: /node_modules[\\/]+(gl-matrix|zod|swr|@zarr|zarr)/,
                            priority: 5,
                        },
                    ],
                },
            },
        },
    },
});
