import { defineConfig } from "vite-plus";

export default defineConfig({
    staged: {
        "src/**": "vp check --fix",
    },
    lint: {
        options: {
            typeAware: true,
            typeCheck: true,
        },
    },
    fmt: {},
});
