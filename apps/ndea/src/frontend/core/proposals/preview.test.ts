import { expect, test } from "bun:test";
import type { Proposal } from "@ndea/protocol";

import { emptyWorkspaceDocument } from "@/core/workspace/document";
import { applyDashboardEdits } from "@/core/workspace/edits";
import { previewProposals } from "./preview";

const base = applyDashboardEdits(emptyWorkspaceDocument(), [
  { op: "set_data", name: "infected", source: { sql: "infected" } },
  { op: "add", type: "count", id: "count" },
]);

const proposal = (ops: unknown[]): Proposal => ({
  id: "p1",
  actor: { kind: "mcp", agent: "omp" },
  createdAt: "2026-01-01T00:00:00Z",
  baseRevision: 1,
  changes: ops.map((op, index) => ({ index, op, summary: `change ${index}`, status: "pending" })),
});

test("an added tile is a ghost; other changes go to review and stay out of the grid", () => {
  const preview = previewProposals(base, [
    proposal([
      { op: "add", type: "text", id: "note", props: { text: "hi" }, at: { beside: "count" } },
      { op: "remove", id: "count" },
      { op: "set_data", name: "infected", source: { sql: "not infected" } },
      { op: "add", type: "text", layout: "nope" },
      { op: "bogus" },
    ]),
  ]);
  expect([...preview.ghosts.keys()]).toEqual(["note"]);
  expect(preview.ghosts.get("note")?.agent).toBe("omp");
  expect(preview.review.map((c) => c.change.index)).toEqual([1, 2, 3, 4]);
  expect(preview.review.at(-1)?.edit).toBeNull();
  // The ghost document holds the new tile but neither the removal nor the source change.
  expect(preview.document?.layouts.main.spec.elements.count).toBeDefined();
  expect(preview.document?.layouts.main.spec.elements.note?.type).toBe("text");
  expect(preview.document?.data.infected).toEqual({ sql: "infected" });
});

test("no pending tile changes means no ghost document", () => {
  const decided = proposal([{ op: "add", type: "text", props: { text: "x" } }]);
  decided.changes[0].status = "rejected";
  const preview = previewProposals(base, [decided]);
  expect(preview.document).toBeNull();
  expect(preview.pending).toEqual([]);
});
