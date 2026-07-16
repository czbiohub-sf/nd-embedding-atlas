import { describe, expect, test } from "bun:test";
import {
  PLUGIN_BOOTSTRAP_SCHEMA_VERSION,
  PluginBootstrapCatalogSchema,
  PluginDiagnosticSchema,
  PluginManifestSchema,
} from "./index.ts";

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
    expect(PluginManifestSchema.safeParse({ ...validManifest, clientEntry: "C:/client.js" }).success).toBe(false);
    expect(PluginManifestSchema.safeParse({ ...validManifest, staticAssets: ["dist/../../secret"] }).success).toBe(
      false,
    );
    expect(PluginManifestSchema.safeParse({ ...validManifest, staticAssets: ["dist/\0secret"] }).success).toBe(false);
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

describe("PluginBootstrapCatalogSchema", () => {
  test("accepts strict same-origin content-addressed entries and diagnostics", () => {
    const digest = "a".repeat(64);
    const catalog = PluginBootstrapCatalogSchema.parse({
      schemaVersion: PLUGIN_BOOTSTRAP_SCHEMA_VERSION,
      entries: [
        {
          sourceId: "project:0",
          manifest: validManifest,
          clientEntryUrl: `/plugins/${digest}/dist/client.js`,
          staticAssetUrls: { "dist/client.css": `/plugins/${digest}/dist/client.css` },
        },
      ],
      diagnostics: [
        {
          sourceId: "user:0",
          severity: "error",
          stage: "manifest",
          code: "manifest-invalid",
          message: "Manifest is malformed",
        },
      ],
    });
    expect(catalog.entries[0]?.sourceId).toBe("project:0");
  });

  test("rejects absolute disk paths, remote URLs, and unknown fields", () => {
    const base = {
      sourceId: "project:0",
      manifest: validManifest,
      clientEntryUrl: "/tmp/client.js",
      staticAssetUrls: {},
    };
    expect(
      PluginBootstrapCatalogSchema.safeParse({
        schemaVersion: 1,
        entries: [base],
        diagnostics: [],
      }).success,
    ).toBe(false);
    expect(
      PluginBootstrapCatalogSchema.safeParse({
        schemaVersion: 1,
        entries: [{ ...base, clientEntryUrl: "https://example.test/client.js" }],
        diagnostics: [],
      }).success,
    ).toBe(false);
    expect(
      PluginDiagnosticSchema.safeParse({
        sourceId: "project:0",
        severity: "error",
        stage: "manifest",
        code: "manifest-invalid",
        message: "bad",
        path: "/secret/plugin",
      }).success,
    ).toBe(false);
  });

  test("accepts frontend import and registration diagnostics", () => {
    for (const stage of ["import", "registration"] as const) {
      expect(
        PluginDiagnosticSchema.safeParse({
          sourceId: "project:0",
          severity: "error",
          stage,
          code: `${stage}-failed`,
          message: `${stage} failed`,
        }).success,
      ).toBe(true);
    }
  });
});
