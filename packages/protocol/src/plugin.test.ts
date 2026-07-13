import { describe, expect, test } from "bun:test";
import { PluginManifestSchema } from "./index.ts";

const validManifest = {
  manifestSchemaVersion: 1,
  pluginId: "example.plugin",
  pluginPackageVersion: "1.2.3",
  sdkVersionRange: "^0.1.0",
  displayName: "Example plugin",
  clientEntry: "dist/client.js",
  staticAssets: ["dist/client.css"],
  hostCompatibility: {
    hostVersionRange: ">=0.1.0",
    platforms: ["darwin", "linux"],
  },
  license: "MIT",
  permissions: [{ permission: "gpu", reason: "Renders a point cloud" }],
};

describe("PluginManifestSchema", () => {
  test("parses every independently versioned manifest field through the protocol barrel", () => {
    const manifest = PluginManifestSchema.parse(validManifest);
    expect(manifest.pluginId as string).toBe("example.plugin");
    expect(manifest.pluginPackageVersion as string).toBe("1.2.3");
    expect(manifest.sdkVersionRange as string).toBe("^0.1.0");
  });

  test("rejects traversal in the client entry and static-asset allowlist", () => {
    expect(PluginManifestSchema.safeParse({ ...validManifest, clientEntry: "../client.js" }).success).toBe(false);
    expect(PluginManifestSchema.safeParse({ ...validManifest, staticAssets: ["dist/../../secret"] }).success).toBe(
      false,
    );
  });

  test("requires a human reason for every high-risk permission disclosure", () => {
    const result = PluginManifestSchema.safeParse({
      ...validManifest,
      permissions: [{ permission: "irreversible-data-write", reason: "" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown manifest keys", () => {
    expect(PluginManifestSchema.safeParse({ ...validManifest, version: "ambiguous" }).success).toBe(false);
  });

  test("rejects unsupported manifest schema versions before plugin execution", () => {
    expect(PluginManifestSchema.safeParse({ ...validManifest, manifestSchemaVersion: 2 }).success).toBe(false);
  });
});
