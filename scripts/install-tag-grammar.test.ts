/**
 * Release-tag grammar parity between `install.sh` and `install.ps1`.
 *
 * Both installers accept a caller-supplied tag and interpolate it straight
 * into a GitHub download URL, so each one validates the tag first. Two
 * implementations of one grammar drift silently, and a tag the POSIX
 * installer rejects should never sail through on Windows.
 *
 * Each validator is extracted from its script and exercised as a real
 * function: the shell one under `sh`, the PowerShell one under `pwsh` via the
 * language parser. Nothing here reimplements the grammar, so a regex edit in
 * either script shows up as a failure rather than a passing copy of itself.
 *
 * The PowerShell half skips when `pwsh` is absent (ordinary on a dev laptop);
 * CI's ubuntu runners ship it.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const SH_INSTALLER = resolve(import.meta.dir, "install.sh");
const PS_INSTALLER = resolve(import.meta.dir, "install.ps1");

/**
 * Tags and whether the grammar accepts them. v-prefixed SemVer, rejecting
 * zero-padded numeric components in both the core version and the
 * pre-release identifiers.
 */
const CASES: readonly (readonly [tag: string, accepted: boolean])[] = [
  ["v0.1.0", true],
  ["v1.2.3", true],
  ["v10.20.30", true],
  ["v0.0.0", true],
  ["v0.1.0-rc.1", true],
  ["v0.1.0-alpha.5", true],
  ["v1.0.0+build.1", true],
  // A dash inside build metadata must not be mistaken for a pre-release.
  ["v1.0.0+build-1", true],
  ["v0.1.0-rc.1+meta", true],
  ["0.1.0", false],
  ["v01.2.3", false],
  ["v0.01.0", false],
  ["v0.1.0-rc.01", false],
  ["v1.2", false],
  ["vx.y.z", false],
  ["", false],
  ["v1.2.3.4", false],
  ["v-1.2.3", false],
  ["latest", false],
];

const TAGS = CASES.map(([tag]) => tag);
const EXPECTED = CASES.map(([, accepted]) => accepted);

describe("release tag grammar", () => {
  test("install.sh accepts and rejects the documented tags", async () => {
    const text = await Bun.file(SH_INSTALLER).text();

    // Lift the function verbatim rather than sourcing the installer, which
    // would run it. Asserting the bounds keeps a reshaped script from
    // silently reducing this to a no-op.
    const start = text.indexOf("is_release_tag() (");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = text.indexOf("\n)\n", start);
    expect(end).toBeGreaterThan(start);
    const fn = text.slice(start, end + 3);

    const args = TAGS.map((tag) => `'${tag.replaceAll("'", "'\\''")}'`).join(" ");
    const script = `${fn}\nfor t in ${args}; do if is_release_tag "$t"; then echo 1; else echo 0; fi; done\n`;
    const proc = Bun.spawnSync(["sh", "-c", script]);

    expect(proc.stdout.toString().trim().split(/\s+/)).toEqual(EXPECTED.map((ok) => (ok ? "1" : "0")));
  });

  test.skipIf(!Bun.which("pwsh"))(
    "install.ps1 matches install.sh exactly",
    () => {
      // Pull Test-ReleaseTag out through the PowerShell parser and define just
      // that function, so the installer's top-level statements never execute.
      const script = `
      $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        '${PS_INSTALLER}', [ref]$null, [ref]$null)
      $fn = $ast.Find({ param($n)
        $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $n.Name -eq 'Test-ReleaseTag' }, $true)
      if (-not $fn) { Write-Error 'Test-ReleaseTag not found in install.ps1'; exit 1 }
      Invoke-Expression $fn.Extent.Text
      foreach ($tag in @(${TAGS.map((t) => `'${t.replaceAll("'", "''")}'`).join(",")})) {
        if (Test-ReleaseTag $tag) { '1' } else { '0' }
      }`;
      const proc = Bun.spawnSync(["pwsh", "-NoProfile", "-Command", script]);

      expect(proc.stdout.toString().trim().split(/\s+/)).toEqual(EXPECTED.map((ok) => (ok ? "1" : "0")));
      // A cold pwsh loads the .NET runtime before running a line of script; on a
      // CI runner that alone exceeds bun's 5s default.
    },
    30_000,
  );
});
