/**
 * Shared transport for CLI commands that talk to a running `ndea view`:
 * the response body goes to stdout as-is; HTTP or connection failures go to
 * stderr and exit 1, so agents can branch on the exit code.
 */

import { option } from "@bunli/core";
import { z } from "zod";

export const serverOptions = {
  port: option(z.coerce.number().int().min(1).max(65535).default(5055), {
    description: "Port of the running ndea server",
  }),
  host: option(z.string().default("127.0.0.1"), {
    description: "Host of the running ndea server",
  }),
};

export async function requestServer(
  server: { host: string; port: number },
  path: string,
  init?: { method: string; body: unknown },
): Promise<void> {
  const url = `http://${server.host}:${server.port}${path}`;
  let res: Response;
  try {
    res = await fetch(
      url,
      init && { method: init.method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) },
    );
  } catch (err) {
    console.error(`Error: no ndea server at ${url} (${err instanceof Error ? err.message : String(err)})`);
    console.error("  Start one with `ndea view <data>`, or pass --host/--port.");
    process.exit(1);
  }
  const body = await res.text();
  if (!res.ok) {
    console.error(body);
    process.exit(1);
  }
  console.log(body);
}

/** Parse a JSON flag value or exit 1 with the flag name in the message. */
export function parseJsonFlag(flag: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error(`Error: --${flag} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
