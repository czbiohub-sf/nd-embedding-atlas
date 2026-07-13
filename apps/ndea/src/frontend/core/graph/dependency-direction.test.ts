import { relative, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const FRONTEND_ROOT = resolve(import.meta.dir, "../..");
const WORKSPACE_ROOT = resolve(FRONTEND_ROOT, "core/workspace");
const BOUNDARY_PATTERNS = [
  "core/graph/**/*.{ts,tsx}",
  "core/plugin/**/*.{ts,tsx}",
  "core/node/**/*.{ts,tsx}",
  "core/node-asset/**/*.{ts,tsx}",
  "nodes/**/*.{ts,tsx}",
] as const;

describe("core dependency direction", () => {
  test("graph, plugin, node, node assets, and node implementations never import Workspace", async () => {
    const violations: string[] = [];
    for (const pattern of BOUNDARY_PATTERNS) {
      for await (const path of new Bun.Glob(pattern).scan({ cwd: FRONTEND_ROOT, onlyFiles: true })) {
        const absolutePath = resolve(FRONTEND_ROOT, path);
        const source = await Bun.file(absolutePath).text();
        const loader = path.endsWith(".tsx") ? "tsx" : "ts";
        for (const imported of new Bun.Transpiler({ loader }).scanImports(source)) {
          const target = imported.path.startsWith("@/")
            ? resolve(FRONTEND_ROOT, imported.path.slice(2))
            : imported.path.startsWith(".")
              ? resolve(absolutePath, "..", imported.path)
              : null;
          if (target && (target === WORKSPACE_ROOT || target.startsWith(`${WORKSPACE_ROOT}/`))) {
            violations.push(`${relative(FRONTEND_ROOT, absolutePath)} -> ${imported.path}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
