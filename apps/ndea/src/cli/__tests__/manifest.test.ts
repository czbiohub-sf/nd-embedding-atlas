/**
 * Unit tests for the manifest fetcher + checksum helpers.
 *
 * Uses an injected `fetchImpl` stub to avoid real network calls.
 */

import { describe, expect, test } from "bun:test";
import {
  detectTarget,
  fetchManifest,
  fetchManifestRaw,
  parseShaFile,
  sha256Hex,
  type Manifest,
} from "../lib/manifest.ts";

// ─── Fake fetch helper ──────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function stubFetch(handler: (input: RequestInfo | URL) => Response | Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL) => {
    return Promise.resolve(handler(input));
  }) as typeof fetch;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("manifest / fetchManifestRaw", () => {
  test("parses a valid manifest", async () => {
    const body: Manifest = { channels: { stable: "v0.1.0", latest: "v0.2.0-rc1" } };
    const m = await fetchManifestRaw({ fetchImpl: stubFetch(() => jsonResponse(body)) });
    expect(m.channels.stable).toBe("v0.1.0");
    expect(m.channels.latest).toBe("v0.2.0-rc1");
  });

  test("accepts a manifest with only one channel", async () => {
    const m = await fetchManifestRaw({
      fetchImpl: stubFetch(() => jsonResponse({ channels: { stable: "v0.1.0" } })),
    });
    expect(m.channels.stable).toBe("v0.1.0");
    expect(m.channels.latest).toBeUndefined();
  });

  test("throws when HTTP status isn't OK", async () => {
    await expect(fetchManifestRaw({ fetchImpl: stubFetch(() => textResponse("not found", 404)) })).rejects.toThrow(
      /manifest fetch failed/,
    );
  });

  test("throws on missing channels field", async () => {
    await expect(fetchManifestRaw({ fetchImpl: stubFetch(() => jsonResponse({})) })).rejects.toThrow(/channels/);
  });

  test("throws on non-object body", async () => {
    await expect(fetchManifestRaw({ fetchImpl: stubFetch(() => jsonResponse(null)) })).rejects.toThrow(/manifest/);
  });

  test("throws on empty string channel value", async () => {
    await expect(
      fetchManifestRaw({ fetchImpl: stubFetch(() => jsonResponse({ channels: { stable: "" } })) }),
    ).rejects.toThrow(/channel/);
  });
});

describe("manifest / fetchManifest", () => {
  test("resolves a stable tag → asset + checksum URLs", async () => {
    const body: Manifest = { channels: { stable: "v0.5.1", latest: "v0.6.0" } };
    const asset = await fetchManifest("stable", {
      fetchImpl: stubFetch(() => jsonResponse(body)),
    });
    expect(asset.tag).toBe("v0.5.1");
    expect(asset.assetUrl).toMatch(/\/releases\/download\/v0\.5\.1\/ndea-/);
    expect(asset.shaUrl.endsWith(".sha256")).toBe(true);
  });

  test("throws when the requested channel is absent", async () => {
    await expect(
      fetchManifest("latest", {
        fetchImpl: stubFetch(() => jsonResponse({ channels: { stable: "v0.1.0" } })),
      }),
    ).rejects.toThrow(/channel "latest"/);
  });
});

describe("manifest / detectTarget", () => {
  test("returns a valid target triple for this host", () => {
    const t = detectTarget();
    expect(["darwin", "linux"]).toContain(t.os);
    expect(["x64", "arm64"]).toContain(t.arch);
    expect(t.assetName).toMatch(/^ndea-(darwin|linux)-(x64|arm64)$/);
  });
});

describe("manifest / sha256Hex + parseShaFile", () => {
  test("hashes the same input deterministically", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const a = sha256Hex(bytes);
    const b = sha256Hex(bytes);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test("parseShaFile accepts bare hex", () => {
    const hex = "a".repeat(64);
    expect(parseShaFile(hex)).toBe(hex);
  });

  test("parseShaFile accepts `<hex>  <filename>` lines", () => {
    const hex = "b".repeat(64);
    expect(parseShaFile(`${hex}  ndea-linux-x64\n`)).toBe(hex);
  });

  test("parseShaFile rejects garbage", () => {
    expect(() => parseShaFile("not a hex digest")).toThrow();
  });
});
