/**
 * The running `ndea view` a client command talks to. `--host`/`--port` pick
 * it, falling back to `NDEA_HOST`/`NDEA_PORT`, then 127.0.0.1:5055.
 * `request` prints the JSON response to stdout; `json` returns it parsed. A
 * server-side failure puts the response body on stderr verbatim, and both it
 * and an unreachable server exit 1, so agents can branch on the exit code.
 * Every request carries `X-Ndea-Client: cli`, so workspace history stamps
 * CLI writes as `cli`.
 */

import { defineContext, defineFlag } from "@crustjs/core";
import { z } from "zod";
import { PlainError } from "./style.ts";

export const portFlag = defineFlag("port", {
  type: "string",
  schema: z.coerce.number().int().min(1).max(65535).default(5055),
  env: { name: "NDEA_PORT" },
  description: "Port of the running ndea server (default: 5055)",
});

export const server = defineContext("server")
  .flags(
    {
      name: "host",
      type: "string",
      default: "127.0.0.1",
      env: { name: "NDEA_HOST" },
      description: "Host of the running ndea server",
    },
    portFlag,
  )
  .setup(({ flags, stdout, signal }) => {
    const origin = `http://${flags.host}:${flags.port}`;
    const send = async (
      path: string,
      init?: { method: string; body: unknown },
      headers?: Record<string, string>,
    ): Promise<string> => {
      let res: Response;
      try {
        res = await fetch(`${origin}${path}`, {
          signal,
          headers: { "x-ndea-client": "cli", ...(init && { "content-type": "application/json" }), ...headers },
          ...(init && { method: init.method, body: JSON.stringify(init.body) }),
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw new Error(
          `no ndea server at ${origin} (${err instanceof Error ? err.message : String(err)})\n` +
            "  start one with `ndea view <data>`, or pass --host/--port (NDEA_HOST/NDEA_PORT)",
          { cause: err },
        );
      }
      const body = await res.text();
      if (!res.ok) throw new PlainError(body);
      return body;
    };
    return {
      origin,
      async request(path: string, init?: { method: string; body: unknown }): Promise<void> {
        stdout(await send(path, init));
      },
      async json<T>(path: string, schema: z.ZodType<T>): Promise<T> {
        return schema.parse(JSON.parse(await send(path)));
      },
      /** GET `path` with extra headers (e.g. the bearer `/api/status` takes); the raw body. */
      text(path: string, headers: Record<string, string>): Promise<string> {
        return send(path, undefined, headers);
      },
    };
  });
