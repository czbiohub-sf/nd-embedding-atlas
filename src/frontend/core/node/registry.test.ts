import { describe, expect, test } from "bun:test";
import type { ComponentType } from "react";
import { z } from "zod";
import {
  getNode,
  getDescriptor,
  parseConfig,
  registerNode,
  registerDescriptor,
  tryRegisterExternalDescriptor,
} from "./registry";
import type { NodeSpec, NodeCapability, NodeDescriptor, NodeViewProps } from "./types";
import { SDK_VERSION } from "./version";

// A minimal valid descriptor. `kind: "transform"` keeps it engine-free; the
// Component is never rendered (these tests only exercise registration logic).
const NoopView: ComponentType<NodeViewProps> = () => null;

function descriptor(id: string, sdkVersion: string = SDK_VERSION): NodeDescriptor {
  return {
    id,
    title: id,
    kind: "transform",
    inputs: [],
    outputs: [],
    capabilities: new Set<NodeCapability>(["read"]),
    placement: { container: "docked" },
    instancePolicy: "multi",
    sdkVersion,
    load: () => Promise.resolve({ Component: NoopView, defaultConfig: {} }),
  };
}

// The shared module-level registry has no reset, so each test uses a unique id
// and the plugin barrel is never imported (no built-ins preloaded here).
describe("plugin registry", () => {
  test("tryRegisterExternalDescriptor accepts a compatible, unique-id plugin", () => {
    const res = tryRegisterExternalDescriptor(descriptor("test-ext-ok"));
    expect(res.ok).toBe(true);
    expect(getDescriptor("test-ext-ok")?.title).toBe("test-ext-ok");
  });

  test("built-ins / already-loaded win: a conflicting external id is rejected (no throw)", () => {
    registerDescriptor(descriptor("test-builtin"));
    const res = tryRegisterExternalDescriptor(descriptor("test-builtin"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/conflicts/);
  });

  test("version gate: a major-incompatible sdkVersion is rejected (no throw)", () => {
    const res = tryRegisterExternalDescriptor(descriptor("test-ext-oldsdk", "9.0.0"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/incompatible/);
  });

  test("registerDescriptor throws on duplicate id and on incompatible sdkVersion", () => {
    registerDescriptor(descriptor("test-dup"));
    expect(() => registerDescriptor(descriptor("test-dup"))).toThrow(/duplicate/);
    expect(() => registerDescriptor(descriptor("test-bad-ver", "9.0.0"))).toThrow(/incompatible/);
  });
});

const baseSpec = (id: string, config?: NodeSpec["config"]): NodeSpec => ({
  id,
  title: id,
  inputs: [],
  outputs: [],
  config,
});

describe("node registry (built-in specs share the plugin registry)", () => {
  test("registerNode + getNode round-trips a base spec", () => {
    registerNode(baseSpec("test-node-basic"));
    expect(getNode("test-node-basic")?.title).toBe("test-node-basic");
  });

  test("registerNode throws on duplicate id", () => {
    registerNode(baseSpec("test-node-dup"));
    expect(() => registerNode(baseSpec("test-node-dup"))).toThrow(/duplicate/);
  });

  test("getDescriptor narrows away non-descriptor specs (no load())", () => {
    registerNode(baseSpec("test-node-notplugin"));
    expect(getNode("test-node-notplugin")).toBeDefined();
    expect(getDescriptor("test-node-notplugin")).toBeUndefined();
  });

  test("parseConfig validates against the schema; configless passes through", () => {
    const spec = { config: z.object({ n: z.number() }) };
    const ok = parseConfig(spec, { n: 3 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.n).toBe(3);

    expect(parseConfig(spec, { n: "nope" }).ok).toBe(false);
    expect(parseConfig({}, { anything: true }).ok).toBe(true);
  });
});
