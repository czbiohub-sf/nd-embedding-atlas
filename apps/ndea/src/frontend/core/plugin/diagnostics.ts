import type { PluginBootstrapEntry, PluginDiagnostic, PluginDiagnosticStage } from "@ndea/protocol";

export const FRONTEND_PLUGIN_BOOTSTRAP_SOURCE = "frontend:plugin-bootstrap";

export function pluginFailureDiagnostic(
  source: Pick<PluginBootstrapEntry, "sourceId" | "manifest"> | undefined,
  stage: Extract<PluginDiagnosticStage, "bootstrap" | "import" | "registration">,
  code: string,
  error: unknown,
): PluginDiagnostic {
  return Object.freeze({
    sourceId: source?.sourceId ?? FRONTEND_PLUGIN_BOOTSTRAP_SOURCE,
    ...(source ? { pluginId: source.manifest.pluginId } : {}),
    severity: "error",
    stage,
    code,
    message: errorMessage(error),
  });
}

export function freezePluginDiagnostics(diagnostics: readonly PluginDiagnostic[]): readonly PluginDiagnostic[] {
  return Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
}

function errorMessage(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : typeof error === "string" && error.trim()
        ? error
        : "Unknown plugin failure";
  return message.slice(0, 2_000);
}
