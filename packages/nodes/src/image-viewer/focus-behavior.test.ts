/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { rowIndex } from "@ndea/sdk";
import {
  focusedObservationPath,
  formatViewerObsReadout,
  shouldRevealViewer,
  syncViewerActivity,
} from "./focus-behavior";
import type { Metadata, ObsInfo, PlateChannel, PlateStore } from "@ndea/protocol";
import { resolveObservationImage } from "./observation-image";

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

  test("keeps the observation request path numerically identical", () => {
    expect(focusedObservationPath(rowIndex(0))).toBe("/api/obs/0");
    expect(focusedObservationPath(rowIndex(4821))).toBe("/api/obs/4821");
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

describe("focused observation image routing", () => {
  const april: PlateStore = { name: "april", mount: "/plate/april", ome_version: "0.5" };
  const july: PlateStore = { name: "july-long-name", mount: "/plate/july-long-name", ome_version: "0.4" };
  const aprilChannels: PlateChannel[] = [
    { label: "April GFP", color: "00FF00", window: { start: 10, end: 100, min: 0, max: 200 } },
  ];
  const julyChannels: PlateChannel[] = [
    { label: "July GFP", color: "FF0000", window: { start: 20, end: 300, min: 0, max: 400 } },
  ];
  const observation: ObsInfo = { dataset: "april", fov_name: "A/2/0000", t: 2, x: 770, y: 156 };
  const metadata = {
    dataset_keys: ["april", "july-long-name", "without-images"],
    plate_stores: [july, april],
    dataset_channels: { april: aprilChannels, "july-long-name": julyChannels },
    plate_channels: julyChannels,
  } satisfies Pick<Metadata, "dataset_keys" | "plate_stores" | "dataset_channels" | "plate_channels">;

  test("selects the observation's mount, version, and channels independently of both orders", () => {
    expect(resolveObservationImage(metadata, observation)).toEqual({
      store: april,
      fovName: "A/2/0000",
      channels: aprilChannels,
    });
    const reversed = {
      ...metadata,
      dataset_keys: ["without-images", "july-long-name", "april"],
      plate_stores: [april, july],
    };
    expect(resolveObservationImage(reversed, { ...observation, dataset: "july-long-name" })).toEqual({
      store: july,
      fovName: "A/2/0000",
      channels: julyChannels,
    });
  });

  test("does not substitute a plate for a dataset without images or an unknown dataset", () => {
    expect(resolveObservationImage(metadata, { ...observation, dataset: "without-images" })).toBeNull();
    expect(resolveObservationImage(metadata, { ...observation, dataset: "unknown" })).toBeNull();
    expect(resolveObservationImage(metadata, { ...observation, dataset: undefined })).toBeNull();
  });

  test("only loads observations matching a dataset-scoped viewer", () => {
    expect(resolveObservationImage(metadata, observation, "july-long-name")).toBeNull();
    expect(resolveObservationImage(metadata, observation, "april")?.store.mount).toBe("/plate/april");
  });

  test("does not borrow global channels from a different dataset when per-dataset metadata is absent", () => {
    const image = resolveObservationImage({ ...metadata, dataset_channels: undefined }, observation);
    expect(image?.store.name).toBe("april");
    expect(image?.channels).toBeUndefined();
  });

  test("retains the unnamed single-dataset v2 mount and channels", () => {
    expect(
      resolveObservationImage(
        {
          plate_stores: [{ name: "", mount: "/plate", ome_version: "0.4" }],
          plate_channels: aprilChannels,
        },
        { fov_name: "A/2/0000", t: 2, x: 770, y: 156 },
      ),
    ).toEqual({
      store: { name: "", mount: "/plate", ome_version: "0.4" },
      fovName: "A/2/0000",
      channels: aprilChannels,
    });
  });

  test("does not load a source before an image-linked observation is available", () => {
    expect(resolveObservationImage(metadata)).toBeNull();
    expect(resolveObservationImage(metadata, { ...observation, fov_name: undefined })).toBeNull();
  });
});
