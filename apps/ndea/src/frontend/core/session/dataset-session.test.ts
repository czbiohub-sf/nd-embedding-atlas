import { describe, expect, test } from "bun:test";
import { nodeInstanceId, rowIndex } from "@ndea/sdk";

import { DatasetDataPublicationRuntime } from "./dataset-session";

describe("DatasetDataPublicationRuntime", () => {
  test("owns monotonic temp-table tokens and idempotent cleanup", async () => {
    const requests: { url: string; method: string }[] = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, method: init?.method ?? "GET" });
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ ok: true, table: "sel_a", count: 1 });
    };
    const runtime = new DatasetDataPublicationRuntime(fetch as typeof globalThis.fetch);
    const id = nodeInstanceId("a");

    const first = await runtime.publishRowSet(id, [rowIndex(1)]);
    const second = await runtime.publishRowSet(id, [rowIndex(2)]);
    expect(second.token).toBeGreaterThan(first.token);
    expect(second.predicate).toContain(`tok=${second.token}`);

    await runtime.disposePublishedRowSet(id);
    await runtime.disposePublishedRowSet(id);
    expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  });

  test("serializes disposal before a newer publication for the same instance", async () => {
    const deletion = Promise.withResolvers<Response>();
    const methods: string[] = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      methods.push(method);
      return method === "DELETE" ? deletion.promise : Response.json({ ok: true, table: "sel_a", count: 1 });
    };
    const runtime = new DatasetDataPublicationRuntime(fetch as typeof globalThis.fetch);
    const id = nodeInstanceId("a");
    await runtime.publishRowSet(id, [rowIndex(1)]);

    const disposing = runtime.disposePublishedRowSet(id);
    const publishing = runtime.publishRowSet(id, [rowIndex(2)]);
    while (methods.length < 2) await Promise.resolve();
    expect(methods).toEqual(["POST", "DELETE"]);

    deletion.resolve(new Response(null, { status: 204 }));
    await disposing;
    await publishing;
    expect(methods).toEqual(["POST", "DELETE", "POST"]);
  });
});
