import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        proxy: {
            "/data": "http://localhost:5055",
            "/api": "http://localhost:5055",
        },
    },
    build: {
        outDir: "dist",
    },
});
