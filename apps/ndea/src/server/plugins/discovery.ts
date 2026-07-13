import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { PluginDiagnosticSchema, type PluginDiagnostic, type PluginManifest } from "@ndea/protocol";
import { isVersionCompatible, SDK_VERSION } from "@ndea/sdk";
import appPackageJson from "../../../package.json";
import { ensureContained, PluginValidationError, readPluginManifest } from "./manifest.ts";

export interface PluginFile {
  relativePath: string;
  canonicalPath: string;
  bytes: Uint8Array;
  kind: "client" | "asset";
}

export interface ValidatedPluginRoot {
  sourceId: string;
  canonicalRoot: string;
  manifest: PluginManifest;
  manifestBytes: Uint8Array;
  files: readonly PluginFile[];
}

export interface PluginRootValidationResult {
  sourceId: string;
  plugin?: ValidatedPluginRoot;
  diagnostics: readonly PluginDiagnostic[];
}

export interface ValidatePluginRootOptions {
  sourceId?: string;
  sdkVersion?: string;
  appVersion?: string;
  platform?: NodeJS.Platform;
  /** Optional canonical or resolvable directory that the root must remain within. */
  containmentRoot?: string;
}

export interface PluginRootSource extends ValidatePluginRootOptions {
  sourceId: string;
  rootPath: string;
}

export interface PluginDiscoveryResult {
  plugins: readonly ValidatedPluginRoot[];
  diagnostics: readonly PluginDiagnostic[];
}

/** Validate one explicit package without evaluating or importing plugin code. */
export async function validatePluginRoot(
  rootPath: string,
  options: ValidatePluginRootOptions = {},
): Promise<PluginRootValidationResult> {
  const sourceId = options.sourceId ?? "explicit:0";
  let pluginId: PluginManifest["pluginId"] | undefined;
  try {
    const canonicalRoot = await canonicalizeDirectory(rootPath);
    if (options.containmentRoot) {
      const canonicalBoundary = await canonicalizeDirectory(options.containmentRoot);
      ensureContained(
        canonicalBoundary,
        canonicalRoot,
        "discovery",
        "root-path-escape",
        "Plugin root resolves outside its allowed packages directory",
      );
    }

    // This must remain before every executable/static file read.
    const { manifest, manifestBytes } = await readPluginManifest(canonicalRoot);
    pluginId = manifest.pluginId;
    validateCompatibility(manifest, options);
    validatePermissionContracts(manifest);

    const files: PluginFile[] = [];
    files.push(await readApprovedFile(canonicalRoot, manifest.clientEntry, "client"));
    validateSelfContainedClient(files[0]?.bytes ?? new Uint8Array());

    const seen = new Set<string>([manifest.clientEntry]);
    for (const assetPath of manifest.staticAssets ?? []) {
      if (seen.has(assetPath)) {
        throw new PluginValidationError("asset", "asset-duplicate", `Asset "${assetPath}" is declared more than once`);
      }
      seen.add(assetPath);
      files.push(await readApprovedFile(canonicalRoot, assetPath, "asset"));
    }

    return {
      sourceId,
      plugin: Object.freeze({
        sourceId,
        canonicalRoot,
        manifest: Object.freeze(manifest),
        manifestBytes,
        files: Object.freeze(files),
      }),
      diagnostics: Object.freeze([]),
    };
  } catch (error) {
    return {
      sourceId,
      diagnostics: Object.freeze([diagnosticFromError(sourceId, pluginId, error)]),
    };
  }
}

/** Discover sources in declaration order; failures remain isolated diagnostics. */
export async function discoverPlugins(sources: readonly PluginRootSource[]): Promise<PluginDiscoveryResult> {
  const plugins: ValidatedPluginRoot[] = [];
  const diagnostics: PluginDiagnostic[] = [];
  for (const source of sources) {
    const result = await validatePluginRoot(source.rootPath, source);
    if (result.plugin) plugins.push(result.plugin);
    diagnostics.push(...result.diagnostics);
  }
  return { plugins: Object.freeze(plugins), diagnostics: Object.freeze(diagnostics) };
}

async function canonicalizeDirectory(path: string): Promise<string> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(path);
  } catch (error) {
    throw new PluginValidationError("discovery", "root-unavailable", "Plugin root does not exist or is unreadable", {
      cause: error,
    });
  }
  const metadata = await stat(canonicalPath);
  if (!metadata.isDirectory()) {
    throw new PluginValidationError("discovery", "root-not-directory", "Plugin root is not a directory");
  }
  return canonicalPath;
}

function validateCompatibility(manifest: PluginManifest, options: ValidatePluginRootOptions): void {
  const sdkVersion = options.sdkVersion ?? String(SDK_VERSION);
  if (!isVersionCompatible(sdkVersion, manifest.sdkVersionRange)) {
    throw new PluginValidationError(
      "compatibility",
      "sdk-version-incompatible",
      `Plugin requires SDK "${manifest.sdkVersionRange}"; current SDK is "${sdkVersion}"`,
    );
  }

  const appVersion = options.appVersion ?? appPackageJson.version;
  if (!isVersionCompatible(appVersion, manifest.hostCompatibility.hostVersionRange)) {
    throw new PluginValidationError(
      "compatibility",
      "app-version-incompatible",
      `Plugin requires app "${manifest.hostCompatibility.hostVersionRange}"; current app is "${appVersion}"`,
    );
  }

  const platform = options.platform ?? process.platform;
  const supportedPlatforms = manifest.hostCompatibility.platforms;
  if (supportedPlatforms && !supportedPlatforms.some((supported) => supported === platform)) {
    throw new PluginValidationError(
      "compatibility",
      "platform-incompatible",
      `Plugin does not support platform "${platform}"`,
    );
  }
}

function validatePermissionContracts(manifest: PluginManifest): void {
  const seen = new Set<string>();
  for (const disclosure of manifest.permissions) {
    if (seen.has(disclosure.permission)) {
      throw new PluginValidationError(
        "manifest",
        "permission-duplicate",
        `Permission "${disclosure.permission}" is disclosed more than once`,
      );
    }
    seen.add(disclosure.permission);
  }
}

async function readApprovedFile(
  canonicalRoot: string,
  relativePath: string,
  kind: PluginFile["kind"],
): Promise<PluginFile> {
  const declaredPath = resolve(canonicalRoot, ...relativePath.split("/"));
  const lexicalRelative = relative(canonicalRoot, declaredPath);
  if (!isContained(lexicalRelative)) {
    throw new PluginValidationError(
      kind === "client" ? "client-entry" : "asset",
      `${kind}-path-escape`,
      `${kind} path escapes the plugin root`,
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(declaredPath);
  } catch (error) {
    throw new PluginValidationError(
      kind === "client" ? "client-entry" : "asset",
      `${kind}-missing`,
      `Declared ${kind} "${relativePath}" does not exist`,
      { cause: error },
    );
  }
  ensureContained(
    canonicalRoot,
    canonicalPath,
    kind === "client" ? "client-entry" : "asset",
    `${kind}-path-escape`,
    `Declared ${kind} "${relativePath}" resolves outside the plugin root`,
  );

  const metadata = await stat(canonicalPath);
  if (!metadata.isFile()) {
    throw new PluginValidationError(
      kind === "client" ? "client-entry" : "asset",
      `${kind}-not-file`,
      `Declared ${kind} "${relativePath}" is not a file`,
    );
  }
  if (kind === "client" && extname(canonicalPath) !== ".js" && extname(canonicalPath) !== ".mjs") {
    throw new PluginValidationError(
      "client-entry",
      "client-extension-invalid",
      "Client entry must be a .js or .mjs file",
    );
  }
  return { relativePath, canonicalPath, bytes: new Uint8Array(await readFile(canonicalPath)), kind };
}

function validateSelfContainedClient(bytes: Uint8Array): void {
  const source = new TextDecoder().decode(bytes);
  try {
    const scan = new Bun.Transpiler({ loader: "js" }).scan(source);
    if (scan.imports.length > 0) {
      throw new PluginValidationError(
        "client-entry",
        "client-runtime-import",
        "Client entry must be self-contained and contain no runtime imports",
      );
    }
  } catch (error) {
    if (error instanceof PluginValidationError) throw error;
    throw new PluginValidationError("client-entry", "client-syntax-invalid", "Client entry is not valid JavaScript", {
      cause: error,
    });
  }
}

function diagnosticFromError(
  sourceId: string,
  pluginId: PluginManifest["pluginId"] | undefined,
  error: unknown,
): PluginDiagnostic {
  const failure =
    error instanceof PluginValidationError
      ? error
      : new PluginValidationError(
          "discovery",
          "validation-failed",
          error instanceof Error ? error.message : String(error),
        );
  return PluginDiagnosticSchema.parse({
    sourceId,
    ...(pluginId ? { pluginId } : {}),
    severity: "error",
    stage: failure.stage,
    code: failure.code,
    message: failure.message,
  });
}

function isContained(value: string): boolean {
  return value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}
