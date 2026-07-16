import { describe, expect, test } from "bun:test";
import type { FocusCoordinationAPI, RowSetPortValue } from "@ndea/sdk";
import {
  gpuPointIndex,
  observationName,
  rowIndex,
  type GpuPointIndex,
  type ObservationName,
  type RowIndex,
} from "./branded-types";

function acceptsRowIndex(_value: RowIndex): void {}
function acceptsGpuPointIndex(_value: GpuPointIndex): void {}
function acceptsObservationName(_value: ObservationName): void {}

function assertNominalIdentitySeparation(): void {
  const row = rowIndex(4);
  const point = gpuPointIndex(4);
  const name = observationName("cell-4");

  acceptsRowIndex(row);
  acceptsGpuPointIndex(point);
  acceptsObservationName(name);

  // @ts-expect-error GPU point positions are not dataset row indices.
  acceptsRowIndex(point);
  // @ts-expect-error Dataset row indices are not GPU point positions.
  acceptsGpuPointIndex(row);
  // @ts-expect-error Durable observation names are not focused row indices.
  acceptsRowIndex(name);
  // @ts-expect-error Focus coordination cannot accept durable observation names.
  (({ set: acceptsRowIndex }) satisfies Pick<FocusCoordinationAPI, "set">).set(name);
  // @ts-expect-error Row sets cannot contain GPU point indices.
  [point] satisfies NonNullable<RowSetPortValue>;
}
void assertNominalIdentitySeparation;

describe("interaction identity constructors", () => {
  test("preserve their primitive wire representations", () => {
    expect(Number(rowIndex(4))).toBe(4);
    expect(Number(gpuPointIndex(4))).toBe(4);
    expect(String(observationName("cell-4"))).toBe("cell-4");
  });
});
