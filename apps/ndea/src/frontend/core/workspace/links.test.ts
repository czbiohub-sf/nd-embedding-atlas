import { expect, test } from "bun:test";

import { emptyWorkspaceDocument } from "./document";
import { applyDashboardEdits } from "./edits";
import { documentLinks, linkMembers, linkValue } from "./links";

test("links: every scope or one element's, their members, and what each holds", () => {
  const doc = applyDashboardEdits(emptyWorkspaceDocument(), [
    { op: "add", type: "table", id: "table", props: { filter: { $bindState: "/filter/A" } } },
    { op: "add", type: "count", id: "count", props: { filter: { $bindState: "/filter/A" } } },
    { op: "bind", id: "table", type: "focus", scope: "B" },
    { op: "set_filter", scope: "A", source: "agent", facet: "x", clause: { op: "eq", column: "t", value: 1 } },
  ]);
  expect(documentLinks(doc)).toEqual([
    { type: "focus", scope: "B" },
    { type: "filter", scope: "A" },
  ]);
  expect(documentLinks(doc, "count")).toEqual([{ type: "filter", scope: "A" }]);
  expect(linkMembers(doc, { type: "filter", scope: "A" }).map(([id]) => id)).toEqual(["table", "count"]);
  expect(linkValue(doc.state, { type: "filter", scope: "A" })).toBe("1 clause");
  expect(linkValue(doc.state, { type: "focus", scope: "B" })).toBe("Nothing focused");
});
