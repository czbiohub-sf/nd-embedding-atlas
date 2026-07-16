const GENERATED_COMMANDS_SOURCE_PATH = ".bunli/commands.gen.ts";

export const GENERATED_COMMANDS_ENTRYPOINT = `./${GENERATED_COMMANDS_SOURCE_PATH}`;

export function generatedCommandsPath(): string {
  const isCompiled = Array.isArray(Bun.embeddedFiles) && Bun.embeddedFiles.length > 0;
  return isCompiled
    ? `/$bunfs/root/${GENERATED_COMMANDS_SOURCE_PATH.replace(/\.ts$/, ".js")}`
    : new URL("../../../../../.bunli/commands.gen.ts", import.meta.url).pathname;
}
