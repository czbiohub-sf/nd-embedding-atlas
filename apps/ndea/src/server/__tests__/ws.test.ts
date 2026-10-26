import { expect, test } from "bun:test";
import type { HarnessEvent } from "@ndea/protocol";

import { Harness } from "../harness.ts";
import { Workspace } from "../workspace.ts";
import { handleWsClose, handleWsMessage, handleWsOpen } from "../ws.ts";

test("harness/watch pushes state on subscribe, on every sighting and change, until unsubscribed", async () => {
  const harness = new Harness(Workspace.memory());
  const frames: (HarnessEvent & { _id: number; _ch?: string })[] = [];
  const ws = {
    data: { state: { harness } },
    send: (raw: string) => frames.push(JSON.parse(raw)),
  } as unknown as Parameters<typeof handleWsOpen>[0];
  const agents = () => (frames.at(-1) as Extract<HarnessEvent, { kind: "state" }>).state.agents;
  handleWsOpen(ws);
  try {
    handleWsMessage(ws, JSON.stringify({ _id: 1, _type: "harness/watch" }));
    await Promise.resolve(); // the handler runs on the next microtask
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ _id: 1, _ch: "data", kind: "state", state: { mode: "propose", proposals: [] } });

    harness.seen("ws-test-agent");
    expect(frames).toHaveLength(2);
    expect(agents()[0]).toMatchObject({ agent: "ws-test-agent" });

    harness.setMode("direct");
    expect(frames.at(-1)).toMatchObject({ kind: "state", state: { mode: "direct" } });

    handleWsMessage(ws, JSON.stringify({ _id: 2, _type: "unsubscribe", target_id: 1 }));
    harness.seen("ws-test-agent");
    expect(frames.filter((frame) => frame._id === 1)).toHaveLength(3);
  } finally {
    handleWsClose(ws);
  }
});
