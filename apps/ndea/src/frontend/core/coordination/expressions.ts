/**
 * Expressions in element props, resolved against the coordination `state`
 * before a view body reads its config:
 *
 *   - `{ $state: "/<type>/<scope>/…" }` → the value at that JSON Pointer.
 *   - `{ $template: "… ${/path} …" }` → the string with each `${…}` replaced
 *     by the value at that pointer (a bare `${name}` reads `/name`; a missing
 *     value is "", an object or array its JSON).
 *
 * Anything else resolves member by member. Pure.
 */

import type { JsonValue } from "@ndea/sdk";

/** The value at a JSON Pointer (RFC 6901: `~1` is "/", `~0` is "~"); "" and "/" are the whole value. */
export function getByPath(value: unknown, path: string): unknown {
  if (!path || path === "/") return value;
  let current = value;
  for (const token of (path.startsWith("/") ? path.slice(1) : path).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current !== null && typeof current === "object" && Object.hasOwn(current, key)) {
      current = (current as Record<string, unknown>)[key];
    } else return undefined;
  }
  return current;
}

/** `value` with every `$state` / `$template` expression in it resolved against `state`. */
export function resolveExpressions(value: JsonValue, state: unknown): JsonValue {
  if (Array.isArray(value)) return value.map((item) => resolveExpressions(item, state));
  if (value === null || typeof value !== "object") return value;
  const { $state, $template } = value;
  if (typeof $state === "string") return getByPath(state, $state) as JsonValue;
  if (typeof $template === "string") {
    return $template.replace(/\$\{([^}]+)\}/g, (_, path: string) => {
      const found = getByPath(state, path) as JsonValue | undefined;
      if (found == null) return "";
      return typeof found === "object" ? JSON.stringify(found) : String(found);
    });
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveExpressions(item, state)]));
}
