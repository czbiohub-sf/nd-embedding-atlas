import { defineCommand } from "@bunli/core";
import { setPluginEnabled } from "./config-mutation.ts";
import { writeCommandError, writeCommandResult } from "./output.ts";

export default defineCommand({
  name: "disable" as const,
  description: "Disable a user plugin package for the next session",
  async handler(context) {
    if (context.positional.length !== 1) {
      writeCommandError(context, "PLUGIN_PATH_REQUIRED", "Usage: ndea plugin disable <relative-package-root>");
      return;
    }

    try {
      const result = await setPluginEnabled(context.positional[0], false);
      const message = result.changed
        ? `Disabled plugin "${result.path}". Changes take effect next session.`
        : result.configured
          ? `Plugin "${result.path}" is already disabled.`
          : `Plugin "${result.path}" is not configured; no changes made.`;
      writeCommandResult(context, { ok: true, data: { ...result, takesEffect: "next-session" } }, [message]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeCommandError(context, "PLUGIN_CONFIG_UPDATE_FAILED", message);
    }
  },
});
