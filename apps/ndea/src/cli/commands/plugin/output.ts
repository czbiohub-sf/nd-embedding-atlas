interface CommandOutput {
  readonly formatExplicit: boolean;
  output(data: unknown): void;
}

export function writeCommandResult(context: CommandOutput, data: unknown, lines: readonly string[]): void {
  if (context.formatExplicit) {
    context.output(data);
    return;
  }
  for (const line of lines) console.log(line);
}

export function writeCommandError(context: CommandOutput, code: string, message: string): void {
  const error = { ok: false, error: { code, message } };
  if (context.formatExplicit) context.output(error);
  else console.error(`Error [${code}]: ${message}`);
  process.exitCode = 1;
}
