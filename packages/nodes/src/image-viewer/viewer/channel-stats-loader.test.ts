import { describe, expect, test } from "bun:test";
import { loadOptionalChannelStats } from "./channel-stats-loader";

describe("loadOptionalChannelStats", () => {
  test("forwards canonical nested FOV identity and dataset key", async () => {
    const calls: [string, string | undefined][] = [];
    const stats = await loadOptionalChannelStats({
      fovName: "A/1/000000",
      datasetKey: "plate-a",
      load: async (fovName, datasetKey) => {
        calls.push([fovName, datasetKey]);
        return [];
      },
    });

    expect(stats).toEqual([]);
    expect(calls).toEqual([["A/1/000000", "plate-a"]]);
  });

  test("normalizes rejection to null and warns with FOV context", async () => {
    const warnings: unknown[][] = [];
    const failure = new Error("stats unavailable");

    const stats = await loadOptionalChannelStats({
      fovName: "A/1/000000",
      load: async () => {
        throw failure;
      },
      warn: (...args) => warnings.push(args),
    });

    expect(stats).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("A/1/000000");
    expect(warnings[0]?.[1]).toBe(failure);
  });

  test("returns null without warning when no stats loader exists", async () => {
    const warnings: unknown[][] = [];
    expect(
      await loadOptionalChannelStats({ fovName: "A/1/000000", warn: (...args) => warnings.push(args) }),
    ).toBeNull();
    expect(warnings).toEqual([]);
  });

  test("suppresses warnings for an aborted stats request", async () => {
    const warnings: unknown[][] = [];
    const controller = new AbortController();
    controller.abort();

    const stats = await loadOptionalChannelStats({
      fovName: "A/1/000000",
      signal: controller.signal,
      load: async () => {
        throw new DOMException("aborted", "AbortError");
      },
      warn: (...args) => warnings.push(args),
    });

    expect(stats).toBeNull();
    expect(warnings).toEqual([]);
  });
});
