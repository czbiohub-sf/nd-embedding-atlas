import { PluginDiagnosticSchema, type PluginDiagnostic } from "@ndea/protocol";
import type { PluginConfig } from "./config.ts";
import { parsePluginConfig, readPluginConfig, resolveUserPluginPath } from "./config.ts";
import { createPluginRuntimeSnapshot, type PluginRuntimeSnapshot } from "./assets.ts";
import { discoverPlugins, validatePluginRoot, type PluginRootSource, type ValidatedPluginRoot } from "./discovery.ts";

export interface BuildPluginBootstrapOptions {
  projectPluginPaths?: readonly string[];
  /** Project YAML directory that every project plugin root must remain within after realpath. */
  projectPluginContainmentRoot?: string;
  /** Override state root for tests; defaults to stateDir() through config helpers. */
  stateRoot?: string;
  /** Prevalidated or raw config override. When absent, config.json is read once. */
  userConfig?: PluginConfig;
  sdkVersion?: string;
  appVersion?: string;
  platform?: NodeJS.Platform;
}

/** Build the complete immutable bootstrap and approved-asset snapshot once at startup. */
export async function buildPluginBootstrap(options: BuildPluginBootstrapOptions = {}): Promise<PluginRuntimeSnapshot> {
  const common = {
    sdkVersion: options.sdkVersion,
    appVersion: options.appVersion,
    platform: options.platform,
  };
  const projectSources: PluginRootSource[] = (options.projectPluginPaths ?? []).map((rootPath, index) => ({
    sourceId: `project:${index}`,
    rootPath,
    containmentRoot: options.projectPluginContainmentRoot,
    ...common,
  }));
  const projectResult = await discoverPlugins(projectSources);

  const diagnostics: PluginDiagnostic[] = [...projectResult.diagnostics];
  const userPlugins: ValidatedPluginRoot[] = [];
  const configWasProvided = options.userConfig !== undefined;
  let userConfig: PluginConfig | undefined;
  if (options.userConfig) {
    try {
      userConfig = parsePluginConfig(options.userConfig);
    } catch {
      diagnostics.push(
        PluginDiagnosticSchema.parse({
          sourceId: "user-config",
          severity: "error",
          stage: "config",
          code: "config-invalid",
          message: "User plugin config is invalid",
        }),
      );
    }
  }
  if (!configWasProvided) {
    try {
      userConfig = await readPluginConfig(options.stateRoot);
    } catch {
      diagnostics.push(
        PluginDiagnosticSchema.parse({
          sourceId: "user-config",
          severity: "error",
          stage: "config",
          code: "config-invalid",
          message: "User plugin config is invalid",
        }),
      );
    }
  }

  if (userConfig) {
    for (let index = 0; index < userConfig.entries.length; index += 1) {
      const entry = userConfig.entries[index];
      if (!entry?.enabled) continue;
      const sourceId = `user:${index}`;
      try {
        const result = await validatePluginRoot(await resolveUserPluginPath(entry.path, options.stateRoot), {
          sourceId,
          ...common,
        });
        if (result.plugin) userPlugins.push(result.plugin);
        diagnostics.push(...result.diagnostics);
      } catch {
        diagnostics.push(
          PluginDiagnosticSchema.parse({
            sourceId,
            severity: "error",
            stage: "config",
            code: "configured-root-invalid",
            message: "Configured plugin root is unavailable or resolves outside the user plugin packages directory",
          }),
        );
      }
    }
  }

  const snapshot = createPluginRuntimeSnapshot([...projectResult.plugins, ...userPlugins], diagnostics);
  return snapshot;
}

export function pluginBootstrapResponse(snapshot: PluginRuntimeSnapshot): Response {
  return Response.json(snapshot.catalog, {
    headers: { "Cache-Control": "no-store" },
  });
}
