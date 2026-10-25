import { expect, test } from "bun:test";
import type { HarnessPresence } from "@ndea/protocol";

import { agentSeen } from "../status.ts";
import { handleWsClose, handleWsMessage, handleWsOpen } from "../ws.ts";

test("harness/watch pushes presence on subscribe and on every sighting until unsubscribed", async () => {
  const frames: (HarnessPresence & { _id: number; _ch?: string })[] = [];
  const ws = { data: {}, send: (raw: string) => frames.push(JSON.parse(raw)) } as unknown as Parameters<
    typeof handleWsOpen
  >[0];
  handleWsOpen(ws);
  try {
    handleWsMessage(ws, JSON.stringify({ _id: 1, _type: "harness/watch" }));
    await Promise.resolve(); // the handler runs on the next microtask
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ _id: 1, _ch: "data" });

    agentSeen("ws-test-agent");
    expect(frames).toHaveLength(2);
    expect(frames[1].agents[0]).toMatchObject({ agent: "ws-test-agent" });

    handleWsMessage(ws, JSON.stringify({ _id: 2, _type: "unsubscribe", target_id: 1 }));
    agentSeen("ws-test-agent");
    expect(frames.filter((frame) => frame._id === 1)).toHaveLength(2);
  } finally {
    handleWsClose(ws);
  }
});
