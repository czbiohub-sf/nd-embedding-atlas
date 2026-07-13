import {
  PLUGIN_CONFIG_SCHEMA_VERSION,
  normalizePluginConfigPath,
  parsePluginConfig,
  readPluginConfig,
  resolveUserPluginPath,
  writePluginConfig,
  type PluginConfig,
} from "../../../server/plugins/config.ts";

export interface PluginStateChange {
  readonly path: string;
  readonly enabled: boolean;
  readonly changed: boolean;
  readonly configured: boolean;
}

function canonicalPackagePath(input: string): string {
  const parsed = parsePluginConfig({
    schemaVersion: PLUGIN_CONFIG_SCHEMA_VERSION,
    entries: [{ path: normalizePluginConfigPath(input), enabled: true }],
  });
  return parsed.entries[0].path;
}

export async function setPluginEnabled(input: string, enabled: boolean): Promise<PluginStateChange> {
  const path = canonicalPackagePath(input);
  if (enabled) await resolveUserPluginPath(path);
  const config = await readPluginConfig();
  const index = config.entries.findIndex((entry) => canonicalPackagePath(entry.path) === path);

  if (index === -1) {
    if (!enabled) return { path, enabled: false, changed: false, configured: false };
    const updated = parsePluginConfig({
      schemaVersion: PLUGIN_CONFIG_SCHEMA_VERSION,
      entries: [...config.entries, { path, enabled: true }],
    });
    await writePluginConfig(updated);
    return { path, enabled: true, changed: true, configured: true };
  }

  const current = config.entries[index];
  if (current.enabled === enabled) return { path: current.path, enabled, changed: false, configured: true };

  const entries: PluginConfig["entries"] = config.entries.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, enabled } : entry,
  );
  await writePluginConfig(parsePluginConfig({ schemaVersion: PLUGIN_CONFIG_SCHEMA_VERSION, entries }));
  return { path: current.path, enabled, changed: true, configured: true };
}
