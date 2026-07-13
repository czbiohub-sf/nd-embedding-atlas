import { defineCommand } from "@bunli/core";
import { setPluginEnabled } from "./config-mutation.ts";
import { writeCommandError, writeCommandResult } from "./output.ts";

export default defineCommand({
  name: "enable" as const,
  description: "Enable a user plugin package for the next session",
  async handler(context) {
    if (context.positional.length !== 1) {
      writeCommandError(context, "PLUGIN_PATH_REQUIRED", "Usage: ndea plugin enable <relative-package-root>");
      return;
    }

    try {
      const result = await setPluginEnabled(context.positional[0], true);
      writeCommandResult(context, { ok: true, data: { ...result, takesEffect: "next-session" } }, [
        result.changed
          ? `Enabled plugin "${result.path}". Changes take effect next session.`
          : `Plugin "${result.path}" is already enabled.`,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeCommandError(context, "PLUGIN_CONFIG_UPDATE_FAILED", message);
    }
  },
});
