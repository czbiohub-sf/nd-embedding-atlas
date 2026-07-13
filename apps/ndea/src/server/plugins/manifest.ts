import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { PluginManifestSchema, type PluginDiagnosticStage, type PluginManifest } from "@ndea/protocol";

export const PLUGIN_MANIFEST_FILENAME = "ndea-plugin.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;

export class PluginValidationError extends Error {
  readonly stage: PluginDiagnosticStage;
  readonly code: string;

  constructor(stage: PluginDiagnosticStage, code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PluginValidationError";
    this.stage = stage;
    this.code = code;
  }
}

export interface ReadPluginManifestResult {
  manifest: PluginManifest;
  manifestBytes: Uint8Array;
}

/** Read and validate the data-only manifest before any executable asset. */
export async function readPluginManifest(canonicalRoot: string): Promise<ReadPluginManifestResult> {
  const declaredPath = join(canonicalRoot, PLUGIN_MANIFEST_FILENAME);
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(declaredPath);
  } catch (error) {
    throw new PluginValidationError("manifest", "manifest-missing", `Missing ${PLUGIN_MANIFEST_FILENAME}`, {
      cause: error,
    });
  }
  ensureContained(
    canonicalRoot,
    canonicalPath,
    "manifest",
    "manifest-path-escape",
    "Manifest resolves outside its plugin root",
  );

  const metadata = await stat(canonicalPath);
  if (!metadata.isFile()) {
    throw new PluginValidationError("manifest", "manifest-not-file", `${PLUGIN_MANIFEST_FILENAME} is not a file`);
  }
  if (metadata.size > MAX_MANIFEST_BYTES) {
    throw new PluginValidationError("manifest", "manifest-too-large", `${PLUGIN_MANIFEST_FILENAME} exceeds 1 MiB`);
  }

  const manifestBytes = new Uint8Array(await readFile(canonicalPath));
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (error) {
    throw new PluginValidationError("manifest", "manifest-json-invalid", "Manifest is not valid JSON", {
      cause: error,
    });
  }

  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PluginValidationError(
      "manifest",
      "manifest-schema-invalid",
      `Manifest does not match schema: ${parsed.error.message}`,
    );
  }
  return { manifest: parsed.data, manifestBytes };
}

export function ensureContained(
  canonicalRoot: string,
  canonicalPath: string,
  stage: PluginDiagnosticStage,
  code: string,
  message: string,
): void {
  const value = relative(canonicalRoot, canonicalPath);
  if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new PluginValidationError(stage, code, message);
  }
}
