import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  detectInstallManager,
  findMiseInstall,
  MISE_TOOL_ID,
  miseUseArgs,
  parseMiseSourcePath,
  type MiseLsEntry,
} from "../lib/install-manager.ts";

const INSTALL_PATH = resolve("/tmp", "mise", "installs", "ndea", "1.2.3");
const SOURCE_PATH = resolve("/tmp", "mise", "config.toml");

function entry(overrides: Partial<MiseLsEntry> = {}): MiseLsEntry {
  return {
    active: true,
    install_path: INSTALL_PATH,
    installed: true,
    requested_version: "1.2.3",
    source: { type: "mise.toml", path: SOURCE_PATH },
    version: "1.2.3",
    ...overrides,
  };
}

describe("mise install detection", () => {
  test("matches active install containing process.execPath", () => {
    const output = JSON.stringify([entry()]);
    expect(findMiseInstall(output, resolve(INSTALL_PATH, "ndea"))).toEqual({
      kind: "mise",
      active: true,
      installPath: INSTALL_PATH,
      version: "1.2.3",
      sourceConfig: SOURCE_PATH,
      requestedVersion: "1.2.3",
      activeVersion: "1.2.3",
    });
  });

  test("identifies inactive installs without matching similarly-prefixed paths", () => {
    const inactive = JSON.stringify([entry({ active: false })]);
    expect(findMiseInstall(inactive, resolve(INSTALL_PATH, "ndea"))).toMatchObject({
      kind: "mise",
      active: false,
      sourceConfig: SOURCE_PATH,
    });

    const output = JSON.stringify([entry()]);
    expect(findMiseInstall(output, resolve(`${INSTALL_PATH}-other`, "ndea"))).toBeNull();
  });

  test("accepts object-shaped output keyed by tool id", () => {
    const output = JSON.stringify({ [MISE_TOOL_ID]: [entry()] });
    expect(findMiseInstall(output, resolve(INSTALL_PATH, "bin", "ndea"))?.sourceConfig).toBe(SOURCE_PATH);
  });

  test("matches canonical paths when a temp-directory alias differs", () => {
    const root = mkdtempSync(resolve(tmpdir(), "ndea-mise-path-"));
    try {
      const installPath = resolve(root, "real", "1.2.3");
      const execPath = resolve(installPath, "ndea");
      mkdirSync(installPath, { recursive: true });
      writeFileSync(execPath, "");
      symlinkSync(resolve(root, "real"), resolve(root, "alias"));

      const output = JSON.stringify([entry({ install_path: resolve(root, "alias", "1.2.3") })]);
      expect(findMiseInstall(output, execPath)?.installPath).toBe(resolve(root, "alias", "1.2.3"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reads the source config off the active entry when the running binary is stale", () => {
    // After `mise use --pin` moves to another version, the previously active
    // install keeps its directory but loses `active` and `source`.
    const stale = entry({ active: false, requested_version: null, source: null, version: "1.2.3" });
    const active = entry({
      install_path: resolve("/tmp", "mise", "installs", "ndea", "1.3.0"),
      requested_version: "1.3.0",
      version: "1.3.0",
    });
    const output = JSON.stringify([stale, active]);

    expect(findMiseInstall(output, resolve(INSTALL_PATH, "ndea"))).toEqual({
      kind: "mise",
      active: false,
      installPath: INSTALL_PATH,
      version: "1.2.3",
      sourceConfig: SOURCE_PATH,
      requestedVersion: "1.3.0",
      activeVersion: "1.3.0",
    });
  });

  test("failed mise query cannot downgrade a mise-owned path to installer", async () => {
    const execPath = resolve(
      "/tmp",
      "custom-data",
      "installs",
      "github-czbiohub-sf-nd-embedding-atlas",
      "1.2.3",
      "ndea",
    );
    const manager = await detectInstallManager(execPath, async () => ({ exitCode: 1, stdout: "" }));
    expect(manager).toMatchObject({ kind: "mise", active: false, sourceConfig: null });
  });

  test("queries targeted mise JSON through injectable runner", async () => {
    let command: readonly string[] = [];
    const manager = await detectInstallManager(resolve(INSTALL_PATH, "ndea"), async (args) => {
      command = args;
      return { exitCode: 0, stdout: JSON.stringify([entry({ requested_version: "latest" })]) };
    });
    expect(command).toEqual(["mise", "ls", "--json", MISE_TOOL_ID]);
    expect(manager).toMatchObject({
      kind: "mise",
      active: true,
      requestedVersion: "latest",
      sourceConfig: SOURCE_PATH,
    });
  });
});

describe("mise source config parsing", () => {
  test("returns source.path only when non-empty", () => {
    expect(parseMiseSourcePath(entry())).toBe(SOURCE_PATH);
    expect(parseMiseSourcePath(entry({ source: { type: "mise.toml" } }))).toBeNull();
    expect(parseMiseSourcePath(entry({ source: { path: "" } }))).toBeNull();
    expect(parseMiseSourcePath(entry({ source: "global" }))).toBeNull();
  });
});

describe("mise use command", () => {
  test("pins exact version without leading v", () => {
    expect(miseUseArgs(SOURCE_PATH, "v1.2.3-rc.1", "pre-release", "latest", false)).toEqual([
      "mise",
      "use",
      "--path",
      SOURCE_PATH,
      "--pin",
      `${MISE_TOOL_ID}@1.2.3-rc.1`,
    ]);
  });

  test("adds force only when requested", () => {
    expect(miseUseArgs(SOURCE_PATH, "v1.2.3", "stable", "1.2.2", true)).toEqual([
      "mise",
      "use",
      "--path",
      SOURCE_PATH,
      "--pin",
      `${MISE_TOOL_ID}@1.2.3`,
      "--force",
    ]);
    expect(miseUseArgs(SOURCE_PATH, "v1.2.3", "stable", "1.2.2", false)).not.toContain("--force");
  });

  test("preserves latest intent for stable and latest channels", () => {
    for (const channel of ["stable", "latest"] as const) {
      expect(miseUseArgs(SOURCE_PATH, "v1.2.3", channel, "latest", false)).toEqual([
        "mise",
        "use",
        "--path",
        SOURCE_PATH,
        `${MISE_TOOL_ID}@latest`,
      ]);
    }
  });
});
