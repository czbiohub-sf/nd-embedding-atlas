import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveFrontendDir, serveStatic } from "./static.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function frontendFixture(): Promise<{ root: string; frontend: string }> {
  const root = await mkdtemp(join(tmpdir(), "ndea-static-"));
  temporaryRoots.push(root);
  const frontend = join(root, "frontend");
  await mkdir(frontend);
  await Promise.all([
    writeFile(join(frontend, "index.html"), "<main>disk frontend</main>"),
    writeFile(join(frontend, "main-abcdef123.js"), "export const disk = true;"),
    writeFile(join(root, "secret.txt"), "outside"),
  ]);
  return { root, frontend };
}

describe("disk static serving", () => {
  test("explicit frontend directory wins and preserves SPA fallback/cache posture", async () => {
    const { frontend } = await frontendFixture();
    expect(resolveFrontendDir(frontend)).toBe(frontend);

    const asset = serveStatic("/main-abcdef123.js", frontend);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("application/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await asset.text()).toBe("export const disk = true;");

    const fallback = serveStatic("/workspace/custom-node", frontend);
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("content-type")).toContain("text/html");
    expect(await fallback.text()).toContain("disk frontend");
  });

  test("never serves a disk path outside the selected frontend root", async () => {
    const { frontend } = await frontendFixture();
    const response = serveStatic("/../secret.txt", frontend);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });
});
