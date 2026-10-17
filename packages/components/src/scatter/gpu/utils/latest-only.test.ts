import { expect, test } from "bun:test";
import { latestOnly } from "./latest-only";

test("a readback requested mid-flight is coalesced, never dropped: the last request runs", async () => {
  const runs: string[] = [];
  let finish: (() => void) | undefined;
  let started = Promise.withResolvers<void>();
  const request = latestOnly((arg: string) => {
    runs.push(arg);
    started.resolve();
    return new Promise<void>((resolve) => (finish = resolve));
  });
  request("drag-1");
  request("drag-2");
  request("pointerup");
  expect(runs).toEqual(["drag-1"]);

  started = Promise.withResolvers<void>();
  finish!();
  await started.promise;
  expect(runs).toEqual(["drag-1", "pointerup"]);
});
