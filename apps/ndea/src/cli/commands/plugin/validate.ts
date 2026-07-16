import { defineCommand } from "@bunli/core";
import type { PluginDiagnostic } from "@ndea/protocol";
import { validatePluginRoot } from "../../../server/plugins/discovery.ts";
import { writeCommandError, writeCommandResult } from "./output.ts";

function compatibilityStatus(
  valid: boolean,
  diagnostics: readonly PluginDiagnostic[],
): "compatible" | "incompatible" | "not-checked" {
  if (valid) return "compatible";
  if (diagnostics.some((diagnostic) => diagnostic.stage === "compatibility")) return "incompatible";
  if (diagnostics.some((diagnostic) => diagnostic.stage === "manifest" || diagnostic.stage === "discovery")) {
    return "not-checked";
  }
  return "compatible";
}

export default defineCommand({
  name: "validate" as const,
  description: "Validate a plugin package without executing its client code",
  async handler(context) {
    if (context.positional.length !== 1) {
      writeCommandError(context, "PLUGIN_ROOT_REQUIRED", "Usage: ndea plugin validate <path>");
      return;
    }

    const root = context.positional[0];
    const result = await validatePluginRoot(root, { sourceId: "cli:validate" });
    const valid = result.plugin !== undefined;
    const compatibility = compatibilityStatus(valid, result.diagnostics);
    const files = result.plugin?.files.map((file) => ({ path: file.relativePath, kind: file.kind })) ?? [];
    const clientEntry = files.find((file) => file.kind === "client")?.path ?? null;
    const staticAssets = files.filter((file) => file.kind === "asset").map((file) => file.path);
    const data = {
      valid,
      sourceId: result.sourceId,
      root,
      manifest: result.plugin?.manifest ?? null,
      compatibility: { status: compatibility },
      clientEntry,
      staticAssets,
      diagnostics: result.diagnostics,
    };

    const lines = valid
      ? [
          `Plugin ${String(result.plugin!.manifest.pluginId)}@${String(result.plugin!.manifest.pluginPackageVersion)} is valid.`,
          "Manifest: valid",
          "Compatibility: compatible",
          `Client entry: ${clientEntry}`,
          `Static assets: ${staticAssets.length > 0 ? staticAssets.join(", ") : "(none)"}`,
        ]
      : [
          "Plugin is invalid.",
          `Manifest: ${compatibility === "not-checked" ? "invalid or unavailable" : "valid"}`,
          `Compatibility: ${compatibility}`,
          `Static assets: ${result.diagnostics.some((diagnostic) => diagnostic.stage === "asset") ? "invalid" : "not approved"}`,
          ...result.diagnostics.map(
            (diagnostic) =>
              `${diagnostic.severity.toUpperCase()} ${diagnostic.stage}/${diagnostic.code}: ${diagnostic.message}`,
          ),
        ];
    writeCommandResult(context, { ok: valid, data }, lines);
    if (!valid) process.exitCode = 1;
  },
});
