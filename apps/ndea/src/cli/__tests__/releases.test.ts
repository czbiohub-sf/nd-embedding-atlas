import { describe, expect, test } from "bun:test";
import { detectTarget, fetchRelease, parseShaFile, sha256Hex, type Target } from "../lib/releases.ts";

const target: Target = {
  os: "linux",
  arch: "x64",
  assetName: "ndea-linux-x64",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function release(
  tag: string,
  options: {
    draft?: boolean;
    prerelease?: boolean;
    publishedAt?: string | null;
    assets?: { name: string; browser_download_url: string }[];
  } = {},
): unknown {
  const base = `https://github.com/czbiohub-sf/nd-embedding-atlas/releases/download/${tag}`;
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    published_at: options.publishedAt === undefined ? "2026-01-01T00:00:00Z" : options.publishedAt,
    assets: options.assets ?? [
      { name: target.assetName, browser_download_url: `${base}/${target.assetName}` },
      { name: `${target.assetName}.sha256`, browser_download_url: `${base}/${target.assetName}.sha256` },
    ],
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function stubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(input, init))) as typeof fetch;
}

describe("fetchRelease", () => {
  test.each(["stable", "latest"] as const)("resolves %s through GitHub's latest release API", async (channel) => {
    let requestedUrl = "";
    const assetUrl = "https://objects.example.test/stable-binary?signature=one";
    const shaUrl = "https://objects.example.test/stable-checksum?signature=two";
    const resolved = await fetchRelease(channel, {
      target,
      fetchImpl: stubFetch((input) => {
        requestedUrl = requestUrl(input);
        return jsonResponse(
          release("v0.5.1", {
            assets: [
              { name: target.assetName, browser_download_url: assetUrl },
              { name: `${target.assetName}.sha256`, browser_download_url: shaUrl },
            ],
          }),
        );
      }),
    });

    expect(requestedUrl).toBe("https://api.github.com/repos/czbiohub-sf/nd-embedding-atlas/releases/latest");
    expect(resolved).toEqual({
      tag: "v0.5.1",
      assetUrl,
      shaUrl,
    });
  });

  test("selects newest published semver pre-release and ignores drafts and stable releases", async () => {
    const assetUrl = "https://objects.example.test/prerelease-binary";
    const shaUrl = "https://objects.example.test/prerelease-checksum";
    const resolved = await fetchRelease("pre-release", {
      target,
      fetchImpl: stubFetch((input) => {
        expect(requestUrl(input)).toBe(
          "https://api.github.com/repos/czbiohub-sf/nd-embedding-atlas/releases?per_page=100",
        );
        return jsonResponse([
          release("v0.8.0-rc.1", {
            draft: true,
            prerelease: true,
            publishedAt: "2026-04-01T00:00:00Z",
          }),
          release("v0.7.0", { publishedAt: "2026-03-01T00:00:00Z" }),
          release("v0.8.0-beta.2", {
            prerelease: true,
            publishedAt: "2026-02-01T00:00:00Z",
            assets: [
              { name: target.assetName, browser_download_url: assetUrl },
              { name: `${target.assetName}.sha256`, browser_download_url: shaUrl },
            ],
          }),
          release("v0.8.0-beta.1", {
            prerelease: true,
            publishedAt: "2026-01-01T00:00:00Z",
          }),
        ]);
      }),
    });

    expect(resolved.tag).toBe("v0.8.0-beta.2");
    expect(resolved.assetUrl).toBe(assetUrl);
    expect(resolved.shaUrl).toBe(shaUrl);
  });

  test("rejects release missing platform binary", async () => {
    await expect(
      fetchRelease("stable", {
        target,
        fetchImpl: stubFetch(() =>
          jsonResponse(
            release("v1.0.0", {
              assets: [
                {
                  name: `${target.assetName}.sha256`,
                  browser_download_url: `https://example.test/${target.assetName}.sha256`,
                },
              ],
            }),
          ),
        ),
      }),
    ).rejects.toThrow(`missing asset ${target.assetName}`);
  });

  test("rejects release missing platform checksum", async () => {
    await expect(
      fetchRelease("stable", {
        target,
        fetchImpl: stubFetch(() =>
          jsonResponse(
            release("v1.0.0", {
              assets: [
                {
                  name: target.assetName,
                  browser_download_url: `https://example.test/${target.assetName}`,
                },
              ],
            }),
          ),
        ),
      }),
    ).rejects.toThrow(`missing asset ${target.assetName}.sha256`);
  });

  test("rejects non-OK API responses", async () => {
    await expect(
      fetchRelease("stable", {
        target,
        fetchImpl: stubFetch(() => new Response("rate limited", { status: 403 })),
      }),
    ).rejects.toThrow(/GitHub Releases fetch failed \(403/);
  });

  test("rejects invalid JSON responses", async () => {
    await expect(
      fetchRelease("stable", {
        target,
        fetchImpl: stubFetch(() => new Response("{", { status: 200, headers: { "Content-Type": "application/json" } })),
      }),
    ).rejects.toThrow(/returned invalid JSON/);
  });

  test("rejects malformed latest-release payload", async () => {
    await expect(
      fetchRelease("latest", {
        target,
        fetchImpl: stubFetch(() => jsonResponse({ tag_name: "v1.0.0" })),
      }),
    ).rejects.toThrow(/invalid release flags/);
  });

  test("rejects unsafe release tags before filesystem callers can use them", async () => {
    await expect(
      fetchRelease("stable", {
        target,
        fetchImpl: stubFetch(() => jsonResponse(release("v../../escape"))),
      }),
    ).rejects.toThrow(/invalid tag_name/);
  });

  test("accepts SemVer pre-release and build metadata in release tags", async () => {
    const resolved = await fetchRelease("pre-release", {
      target,
      fetchImpl: stubFetch(() =>
        jsonResponse([
          release("v1.2.3-rc.1+linux.7", {
            prerelease: true,
            publishedAt: "2026-06-01T00:00:00Z",
          }),
        ]),
      ),
    });
    expect(resolved.tag).toBe("v1.2.3-rc.1+linux.7");
  });

  test("rejects malformed pre-release payload", async () => {
    await expect(
      fetchRelease("pre-release", {
        target,
        fetchImpl: stubFetch(() => jsonResponse({})),
      }),
    ).rejects.toThrow(/not an array/);
  });

  test("rejects pre-release payload without a published candidate", async () => {
    await expect(
      fetchRelease("pre-release", {
        target,
        fetchImpl: stubFetch(() =>
          jsonResponse([release("v1.0.0", {}), release("v1.0.0-rc.1", { prerelease: true, publishedAt: null })]),
        ),
      }),
    ).rejects.toThrow(/no published pre-release/);
  });
});

describe("detectTarget", () => {
  test("returns supported host target and matching asset name", () => {
    const detected = detectTarget();
    expect(["darwin", "linux"]).toContain(detected.os);
    expect(["x64", "arm64"]).toContain(detected.arch);
    expect(detected.assetName).toBe(`ndea-${detected.os}-${detected.arch}`);
  });
});

describe("checksum helpers", () => {
  test("sha256Hex computes known digest", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("parseShaFile accepts bare uppercase hex and normalizes it", () => {
    expect(parseShaFile("A".repeat(64))).toBe("a".repeat(64));
  });

  test("parseShaFile accepts checksum filename form", () => {
    const hex = "b".repeat(64);
    expect(parseShaFile(`${hex}  ndea-linux-x64\n`)).toBe(hex);
  });

  test("parseShaFile rejects malformed content", () => {
    expect(() => parseShaFile("not a digest")).toThrow(/unrecognised checksum/);
  });
});
