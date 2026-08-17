/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

describe("nodes package dependency direction", () => {
  test("does not import app aliases or app-relative modules", async () => {
    const violations: string[] = [];
    for await (const path of new Bun.Glob("src/**/*.{ts,tsx}").scan({ cwd: `${import.meta.dir}/..` })) {
      const source = await Bun.file(`${import.meta.dir}/../${path}`).text();
      for (const imported of new Bun.Transpiler({ loader: path.endsWith(".tsx") ? "tsx" : "ts" }).scanImports(source)) {
        if (imported.path.startsWith("@/") || imported.path.includes("apps/ndea")) {
          violations.push(`${path} -> ${imported.path}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
