import { expect, test } from "bun:test";

import { isConnected, relativeTime } from "./presence";

test("relativeTime picks the largest unit", () => {
  const now = Date.parse("2026-01-01T00:10:00Z");
  expect(relativeTime("2026-01-01T00:09:55Z", now)).toBe("5s ago");
  expect(relativeTime("2026-01-01T00:07:00Z", now)).toBe("3m ago");
});

test("an agent is connected for five minutes after its last MCP request", () => {
  const now = Date.parse("2026-01-01T00:10:00Z");
  expect(isConnected({ agent: "omp", lastSeen: "2026-01-01T00:05:01Z" }, now)).toBe(true);
  expect(isConnected({ agent: "omp", lastSeen: "2026-01-01T00:05:00Z" }, now)).toBe(false);
});
