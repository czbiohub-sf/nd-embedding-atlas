import { defineGroup } from "@bunli/core";
import disableCommand from "./disable.ts";
import enableCommand from "./enable.ts";
import listCommand from "./list.ts";
import validateCommand from "./validate.ts";

export default defineGroup({
  name: "plugin" as const,
  description: "Validate and configure trusted custom-node plugins",
  commands: [validateCommand, listCommand, enableCommand, disableCommand],
});
