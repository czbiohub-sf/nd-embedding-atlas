/**
 * The bearer token `/mcp` requires. It lives in `~/.ndea/mcp-token` so agent
 * configs written by `ndea mcp install` survive server restarts. Kept apart
 * from `mcp.ts` so the CLI can read it without loading the graph engine.
 */

import { timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { stateDir } from "../cli/lib/paths.ts";

/** Read the token, creating it with owner-only permissions on first use. */
export async function loadMcpToken(path = join(stateDir(), "mcp-token")): Promise<string> {
  try {
    const token = (await readFile(path, "utf8")).trim();
    if (token) return token;
  } catch {
    // first run: create it below
  }
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}

/** Constant-time check of `Authorization: Bearer <token>`. */
export function hasBearer(request: Request, token: string): boolean {
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
