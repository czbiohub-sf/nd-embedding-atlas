/** Element-level document comparison, kept for proposal summaries (G6). */

import { createPatch } from "rfc6902";

export interface DocumentChange {
  section: "element" | "data" | "state" | "layout";
  key: string;
  change: "added" | "removed" | "type" | "props" | "children" | "changed";
}

const ELEMENT_FIELDS = new Set(["type", "props", "children"]);

/**
 * Element-level summary of what differs from `before` to `after`: elements
 * (of any layout) added, removed, retyped, or with changed props or children;
 * data sources, state cells (`<type>/<scope>`), and layouts (added, removed,
 * renamed, re-rooted; key "" is the active layout) added, removed, or changed.
 */
export function compareDocuments(before: unknown, after: unknown): DocumentChange[] {
  const changes = new Map<string, DocumentChange>();
  for (const op of createPatch(before, after)) {
    const path = op.path
      .split("/")
      .slice(1)
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    const element = path[0] === "layouts" && path[2] === "spec" && path[3] === "elements" && path.length > 4;
    // Path length of the item itself: an op exactly there adds or removes it; deeper ops change it.
    const [section, depth]: [DocumentChange["section"], number] = element
      ? ["element", 5]
      : path[0] === "data"
        ? ["data", 2]
        : path[0] === "state"
          ? ["state", 3]
          : ["layout", 2];
    const field = path[depth] ?? "";
    const change: DocumentChange["change"] =
      path.length > depth
        ? element && ELEMENT_FIELDS.has(field)
          ? (field as DocumentChange["change"])
          : "changed"
        : op.op === "add"
          ? "added"
          : op.op === "remove"
            ? "removed"
            : "changed";
    const key = path.slice(element ? 4 : 1, depth).join("/");
    changes.set(`${section}\0${key}\0${change}`, { section, key, change });
  }
  return [...changes.values()];
}
