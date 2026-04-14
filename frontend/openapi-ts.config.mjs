import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "http://localhost:5055/openapi.json",
  output: {
    path: "src/generated",
    format: "prettier",
  },
  plugins: ["@hey-api/typescript"],
});
