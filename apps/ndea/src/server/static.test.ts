import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveFrontendDir, serveStatic } from "./static.ts";
import { readPlateMeta } from "./plate.ts";

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

describe("plate OME-Zarr metadata", () => {
  async function plateFixture(
    format: 2 | 3,
    versionLocation: "image" | "plate" | "multiscales" | "legacy-plate",
  ): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "ndea-plate-"));
    temporaryRoots.push(root);
    const image = join(root, "A", "1", "0");
    await mkdir(image, { recursive: true });
    const version = format === 3 ? "0.5" : "0.4";
    const plateAttrs = {
      ...(versionLocation === "plate" ? { version } : {}),
      plate: {
        ...(versionLocation === "legacy-plate" ? { version } : {}),
        wells: [{ path: "A/1" }],
      },
    };
    const imageAttrs = {
      ...(versionLocation === "image" ? { version } : {}),
      multiscales: [
        {
          ...(versionLocation === "multiscales" ? { version } : {}),
          axes: [{ name: "t" }, { name: "c" }, { name: "z" }, { name: "y" }, { name: "x" }],
          datasets: [{ path: "0", coordinateTransformations: [{ type: "scale", scale: [1, 1, 2, 0.25, 0.5] }] }],
        },
      ],
      omero: {
        channels: [{ label: "GFP", color: "00FF00", window: { start: 10, end: 100, min: 0, max: 200 } }],
      },
    };
    for (const [directory, attributes] of [
      [root, plateAttrs],
      [image, imageAttrs],
    ] as const) {
      if (format === 3) {
        await writeFile(
          join(directory, "zarr.json"),
          JSON.stringify({ zarr_format: 3, node_type: "group", attributes: { ome: attributes } }),
        );
      } else {
        await writeFile(join(directory, ".zgroup"), JSON.stringify({ zarr_format: 2 }));
        await writeFile(join(directory, ".zattrs"), JSON.stringify(attributes));
      }
    }
    return root;
  }

  for (const versionLocation of ["image", "plate"] as const) {
    test(`recognizes OME 0.5 declared only on the ${versionLocation} OME wrapper`, async () => {
      const root = await plateFixture(3, versionLocation);
      expect(await readPlateMeta(root)).toEqual({
        omeVersion: "0.5",
        pixelScale: { x: 0.5, y: 0.25 },
        channels: [{ label: "GFP", color: "00FF00", window: { start: 10, end: 100, min: 0, max: 200 } }],
      });
    });
  }

  for (const versionLocation of ["multiscales", "legacy-plate"] as const) {
    test(`retains OME 0.4 ${versionLocation} metadata`, async () => {
      const root = await plateFixture(2, versionLocation);
      expect(await readPlateMeta(root)).toEqual({
        omeVersion: "0.4",
        pixelScale: { x: 0.5, y: 0.25 },
        channels: [{ label: "GFP", color: "00FF00", window: { start: 10, end: 100, min: 0, max: 200 } }],
      });
    });
  }
});
