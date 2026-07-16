import { describe, expect, test } from "bun:test";
import { PLUGIN_BOOTSTRAP_SCHEMA_VERSION } from "@ndea/protocol";
import { fetchPluginBootstrap, importPluginFactory, type PluginBootstrapFetch } from "./loader";

const validBootstrapFetch: PluginBootstrapFetch = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        schemaVersion: PLUGIN_BOOTSTRAP_SCHEMA_VERSION,
        entries: [],
        diagnostics: [],
      }),
    ),
  );

const unavailableBootstrapFetch: PluginBootstrapFetch = () =>
  Promise.resolve(new Response("unavailable", { status: 503, statusText: "Unavailable" }));

describe("plugin bootstrap loader", () => {
  test("parses the strict bootstrap schema", async () => {
    await expect(fetchPluginBootstrap(validBootstrapFetch)).resolves.toMatchObject({ entries: [], diagnostics: [] });
  });

  test("rejects unsuccessful responses before reading plugin entries", async () => {
    await expect(fetchPluginBootstrap(unavailableBootstrapFetch)).rejects.toThrow("503 Unavailable");
  });

  test("requires a default factory export", async () => {
    await expect(importPluginFactory("/plugins/validated/client.js", () => Promise.resolve({}))).rejects.toThrow(
      "default factory",
    );
    await expect(
      importPluginFactory("/plugins/validated/client.js", () => Promise.resolve({ default: "not-a-function" })),
    ).rejects.toThrow("factory function");
  });
});
