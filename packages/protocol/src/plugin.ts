import { z } from "zod";

const PACKAGE_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const RELATIVE_ASSET_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/;

export const PluginManifestSchemaVersionSchema = z.literal(1).brand<"PluginManifestSchemaVersion">();
export type PluginManifestSchemaVersion = z.infer<typeof PluginManifestSchemaVersionSchema>;
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as PluginManifestSchemaVersion;

export const PluginIdSchema = z.string().min(1).max(128).regex(PACKAGE_ID_RE).brand<"PluginId">();
export type PluginId = z.infer<typeof PluginIdSchema>;

export const PluginPackageVersionSchema = z.string().min(1).brand<"PluginPackageVersion">();
export type PluginPackageVersion = z.infer<typeof PluginPackageVersionSchema>;

export const SDKVersionRangeSchema = z.string().min(1).brand<"SDKVersionRange">();
export type SDKVersionRange = z.infer<typeof SDKVersionRangeSchema>;

export const PluginPermissionSchema = z.enum([
  "network",
  "filesystem-import",
  "filesystem-export",
  "clipboard-read",
  "clipboard-write",
  "gpu",
  "schema-mutation",
  "irreversible-data-write",
]);
export type PluginPermission = z.infer<typeof PluginPermissionSchema>;

export const PluginPermissionDisclosureSchema = z.strictObject({
  permission: PluginPermissionSchema,
  reason: z.string().trim().min(1).max(500),
});
export type PluginPermissionDisclosure = z.infer<typeof PluginPermissionDisclosureSchema>;

export const PluginPlatformSchema = z.enum(["darwin", "linux", "win32"]);
export type PluginPlatform = z.infer<typeof PluginPlatformSchema>;

export const PluginHostCompatibilitySchema = z.strictObject({
  hostVersionRange: z.string().min(1),
  platforms: z.array(PluginPlatformSchema).min(1).optional(),
});
export type PluginHostCompatibility = z.infer<typeof PluginHostCompatibilitySchema>;

const PluginAssetPathSchema = z
  .string()
  .min(1)
  .regex(RELATIVE_ASSET_PATH_RE, "Expected a contained relative asset path");

/**
 * Serialized manifest read before any plugin code executes.
 *
 * Plugin and SDK versions deliberately have qualified field names because they
 * advance independently. Static assets are an allowlist, not a directory root.
 */
export const PluginManifestSchema = z.strictObject({
  manifestSchemaVersion: PluginManifestSchemaVersionSchema,
  pluginId: PluginIdSchema,
  pluginPackageVersion: PluginPackageVersionSchema,
  sdkVersionRange: SDKVersionRangeSchema,
  displayName: z.string().trim().min(1).max(200),
  clientEntry: PluginAssetPathSchema,
  staticAssets: z.array(PluginAssetPathSchema).max(512).optional(),
  hostCompatibility: PluginHostCompatibilitySchema,
  license: z.string().trim().min(1).max(128),
  permissions: z.array(PluginPermissionDisclosureSchema).default([]),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
