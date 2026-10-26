/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { rowIndex } from "@ndea/sdk";
import { formatViewerObsReadout, shouldRevealViewer, syncViewerActivity } from "./focus-behavior";

describe("image viewer focus behavior", () => {
  test("pauses with no focus and resumes for row zero or any later row", () => {
    const calls: string[] = [];
    const actions = {
      pause: () => calls.push("pause"),
      resume: () => calls.push("resume"),
    };

    syncViewerActivity(actions, null);
    syncViewerActivity(actions, rowIndex(0));
    syncViewerActivity(actions, rowIndex(42));

    expect(calls).toEqual(["pause", "resume", "resume"]);
  });

  test("formats the focused observation readout without changing its values", () => {
    expect(formatViewerObsReadout(void 0)).toBeNull();
    expect(formatViewerObsReadout({})).toBeNull();
    expect(formatViewerObsReadout({ fov_name: "FOV-7" })).toBe("FOV-7");
    expect(formatViewerObsReadout({ fov_name: "FOV-7", track_id: 0, t: 0 })).toBe("FOV-7 · #0 · T 0");
  });

  test("reveals pixels only after the focused observation and its layers are ready", () => {
    expect(shouldRevealViewer({ observationReady: false, sourceReady: false, aggregateState: null })).toBe(false);
    expect(shouldRevealViewer({ observationReady: true, sourceReady: false, aggregateState: "ready" })).toBe(false);
    expect(shouldRevealViewer({ observationReady: true, sourceReady: true, aggregateState: "initialized" })).toBe(
      false,
    );
    expect(shouldRevealViewer({ observationReady: true, sourceReady: true, aggregateState: "loading" })).toBe(false);
    expect(shouldRevealViewer({ observationReady: true, sourceReady: true, aggregateState: "ready" })).toBe(true);
  });
});
