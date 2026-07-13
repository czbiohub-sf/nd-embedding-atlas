import { defineCommand } from "@bunli/core";
import { readPluginConfig } from "../../../server/plugins/config.ts";
import { writeCommandError, writeCommandResult } from "./output.ts";

export default defineCommand({
  name: "list" as const,
  description: "List configured user plugin roots in discovery order",
  async handler(context) {
    try {
      const config = await readPluginConfig();
      writeCommandResult(
        context,
        { ok: true, data: config },
        config.entries.length === 0
          ? ["No user plugins configured."]
          : [
              "User plugins (discovery order):",
              ...config.entries.map((entry) => `  [${entry.enabled ? "enabled" : "disabled"}] ${entry.path}`),
            ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeCommandError(context, "PLUGIN_CONFIG_READ_FAILED", message);
    }
  },
});
