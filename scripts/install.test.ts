/**
 * End-to-end tests for `scripts/install.sh`.
 *
 * The installer runs as a real process against a sandboxed `$HOME`, with a stub
 * `curl` earlier on `$PATH` than the real one. Every code path therefore runs
 * unmodified — argument parsing, the awk release scan, checksum verification,
 * the lock, and the atomic symlink swap — with no network access and no
 * test-only hooks inside the script.
 *
 * `uname` is stubbed as well, so the artifact name is `ndea-linux-x64` on every
 * runner and one set of fixtures serves the whole CI matrix.
 */

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const INSTALLER = resolve(import.meta.dir, "install.sh");
const REPO = "czbiohub-sf/nd-embedding-atlas";
const API = `https://api.github.com/repos/${REPO}/releases`;
const DOWNLOAD = `https://github.com/${REPO}/releases/download`;
const ARTIFACT = "ndea-linux-x64";

/** Stub `curl`, covering only the two invocations install.sh makes. */
const FAKE_CURL = `#!/bin/sh
out=""
url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out=$2; shift 2 ;;
        --proto) shift 2 ;;
        -*) shift ;;
        *) url=$1; shift ;;
    esac
done
key=$(printf '%s' "$url" | sed 's|[^A-Za-z0-9._-]|_|g')
file="$FIXTURE_DIR/$key"
# 22 is curl's exit code for an HTTP error response under -f.
[ -f "$file" ] || exit 22
if [ -n "$out" ]; then cp "$file" "$out"; else cat "$file"; fi
`;

interface Sandbox {
  root: string;
  home: string;
  fixtures: string;
  stubs: string;
}

interface RunResult {
  exitCode: number;
  /** Everything the installer printed; progress goes to stderr. */
  output: string;
}

function fixtureKey(url: string): string {
  return url.replaceAll(/[^A-Za-z0-9._-]/g, "_");
}

function writeStub(sandbox: Sandbox, name: string, body: string): void {
  const path = resolve(sandbox.stubs, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function stubUname(sandbox: Sandbox, kernel: string, machine: string): void {
  writeStub(
    sandbox,
    "uname",
    `#!/bin/sh\ncase "\${1:-}" in\n  -m) printf '%s\\n' '${machine}' ;;\n  *) printf '%s\\n' '${kernel}' ;;\nesac\n`,
  );
}

function createSandbox(): Sandbox {
  const root = mkdtempSync(resolve(tmpdir(), "ndea-install-"));
  const sandbox: Sandbox = {
    root,
    home: resolve(root, "home"),
    fixtures: resolve(root, "fixtures"),
    stubs: resolve(root, "stubs"),
  };
  for (const dir of [sandbox.home, sandbox.fixtures, sandbox.stubs]) mkdirSync(dir, { recursive: true });
  writeStub(sandbox, "curl", FAKE_CURL);
  stubUname(sandbox, "Linux", "x86_64");
  return sandbox;
}

function serve(sandbox: Sandbox, url: string, body: string): void {
  writeFileSync(resolve(sandbox.fixtures, fixtureKey(url)), body);
}

function sha256(contents: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(contents);
  return hasher.digest("hex");
}

/** Publish a downloadable binary plus the `sha256sum -c` manifest beside it. */
function serveAsset(sandbox: Sandbox, tag: string, contents: string, checksum?: string): void {
  serve(sandbox, `${DOWNLOAD}/${tag}/${ARTIFACT}`, contents);
  serve(sandbox, `${DOWNLOAD}/${tag}/${ARTIFACT}.sha256`, `${checksum ?? sha256(contents)}  ${ARTIFACT}\n`);
}

function releaseJson(
  tag: string,
  options: { draft?: boolean; prerelease?: boolean; publishedAt?: string } = {},
): string {
  return JSON.stringify({
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    published_at: options.publishedAt ?? "2026-01-01T00:00:00Z",
  });
}

/** The awk scan walks the array in order, so newest-first mirrors the API. */
function serveReleaseList(sandbox: Sandbox, entries: string[]): void {
  serve(sandbox, `${API}?per_page=100`, `[${entries.join(",")}]`);
}

async function runInstaller(
  sandbox: Sandbox,
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<RunResult> {
  const proc = Bun.spawn(["sh", INSTALLER, ...args], {
    env: {
      PATH: `${sandbox.stubs}:${process.env.PATH ?? ""}`,
      HOME: sandbox.home,
      FIXTURE_DIR: sandbox.fixtures,
      SHELL: "/bin/zsh",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, output: stdout + stderr };
}

function installedBinary(sandbox: Sandbox, tag: string): string {
  return resolve(sandbox.home, ".ndea", "versions", tag, "ndea");
}

function launcher(sandbox: Sandbox): string {
  return resolve(sandbox.home, ".local", "bin", "ndea");
}

function withSandbox(body: (sandbox: Sandbox) => Promise<void>): () => Promise<void> {
  return async () => {
    const sandbox = createSandbox();
    try {
      await body(sandbox);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  };
}

describe("install.sh happy path", () => {
  test(
    "installs an explicit tag into the versions tree and links it onto PATH",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "#!/bin/sh\necho ndea v0.4.2\n");

      const result = await runInstaller(sandbox, ["v0.4.2"]);
      expect(result.exitCode).toBe(0);

      const binary = installedBinary(sandbox, "v0.4.2");
      expect(readFileSync(binary, "utf8")).toContain("ndea v0.4.2");
      expect(readlinkSync(launcher(sandbox))).toBe(binary);
    }),
  );

  test(
    "records current-version in the two-line tag/checksum form `ndea update` writes",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "binary-bytes");

      expect((await runInstaller(sandbox, ["v0.4.2"])).exitCode).toBe(0);

      const recorded = readFileSync(resolve(sandbox.home, ".ndea", "current-version"), "utf8");
      expect(recorded).toBe(`v0.4.2\n${sha256("binary-bytes")}\n`);
    }),
  );

  test(
    "defaults to the stable channel and its canonical latest-release endpoint",
    withSandbox(async (sandbox) => {
      serve(sandbox, `${API}/latest`, releaseJson("v1.2.3"));
      serveAsset(sandbox, "v1.2.3", "stable");

      const result = await runInstaller(sandbox);
      expect(result.exitCode).toBe(0);
      expect(readlinkSync(launcher(sandbox))).toBe(installedBinary(sandbox, "v1.2.3"));
    }),
  );

  test(
    "repoints the launcher on reinstall and keeps the previous version on disk",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "old");
      serveAsset(sandbox, "v0.5.0", "new");

      expect((await runInstaller(sandbox, ["v0.4.2"])).exitCode).toBe(0);
      expect((await runInstaller(sandbox, ["v0.5.0"])).exitCode).toBe(0);

      expect(readlinkSync(launcher(sandbox))).toBe(installedBinary(sandbox, "v0.5.0"));
      expect(readFileSync(installedBinary(sandbox, "v0.4.2"), "utf8")).toBe("old");
    }),
  );
});

describe("install.sh pre-release selection", () => {
  test(
    "takes the newest published pre-release and ignores drafts and stable releases",
    withSandbox(async (sandbox) => {
      serveReleaseList(sandbox, [
        releaseJson("v0.8.0-rc.1", { prerelease: true, draft: true }),
        releaseJson("v0.7.0"),
        releaseJson("v0.6.0-beta.2", { prerelease: true }),
      ]);
      serveAsset(sandbox, "v0.6.0-beta.2", "beta");

      const result = await runInstaller(sandbox, ["pre-release"]);
      expect(result.exitCode).toBe(0);
      expect(readlinkSync(launcher(sandbox))).toBe(installedBinary(sandbox, "v0.6.0-beta.2"));
    }),
  );

  test(
    "treats a tag with build metadata as an ordinary pre-release",
    withSandbox(async (sandbox) => {
      // Build metadata carries no SemVer precedence, so a `+meta` tag is an
      // ordinary pre-release and wins on recency.
      serveReleaseList(sandbox, [
        releaseJson("v0.9.0-rc.1+build.5", { prerelease: true }),
        releaseJson("v0.8.0-beta.1", { prerelease: true }),
      ]);
      serveAsset(sandbox, "v0.9.0-rc.1+build.5", "rc");

      const result = await runInstaller(sandbox, ["pre-release"]);
      expect(result.exitCode).toBe(0);
      expect(readlinkSync(launcher(sandbox))).toBe(installedBinary(sandbox, "v0.9.0-rc.1+build.5"));
    }),
  );
});

describe("install.sh failure modes", () => {
  test(
    "rejects an unknown selector and names the accepted values",
    withSandbox(async (sandbox) => {
      const result = await runInstaller(sandbox, ["nightly"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("unknown selector 'nightly'");
      expect(result.output).toContain("stable|latest|pre-release|<tag>");
    }),
  );

  test(
    "explains a tag whose assets are missing instead of surfacing a bare curl failure",
    withSandbox(async (sandbox) => {
      const result = await runInstaller(sandbox, ["v9.9.9"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("does that release exist?");
    }),
  );

  test(
    "aborts on a checksum mismatch without installing or linking anything",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "real-bytes", "0".repeat(64));

      const result = await runInstaller(sandbox, ["v0.4.2"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("checksum verification failed");
      expect(await Bun.file(installedBinary(sandbox, "v0.4.2")).exists()).toBe(false);
      expect(await Bun.file(launcher(sandbox)).exists()).toBe(false);
    }),
  );

  test(
    "leaves an existing install untouched when a later download fails",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "good");
      expect((await runInstaller(sandbox, ["v0.4.2"])).exitCode).toBe(0);

      expect((await runInstaller(sandbox, ["v0.5.0"])).exitCode).not.toBe(0);
      expect(readlinkSync(launcher(sandbox))).toBe(installedBinary(sandbox, "v0.4.2"));
    }),
  );

  test(
    "names the supported platforms when the host is not one of them",
    withSandbox(async (sandbox) => {
      stubUname(sandbox, "Linux", "riscv64");

      const result = await runInstaller(sandbox, ["v0.4.2"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("unsupported platform: linux/riscv64");
      expect(result.output).toContain("darwin/arm64, linux/x64, linux/arm64");
    }),
  );

  test(
    "refuses to run under sudo, which would install into root's home",
    withSandbox(async (sandbox) => {
      writeStub(sandbox, "id", "#!/bin/sh\nprintf '0\\n'\n");

      const result = await runInstaller(sandbox, ["v0.4.2"], { SUDO_USER: "alice" });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("do not run this installer with sudo");
    }),
  );

  test(
    "reports a live install lock rather than racing it",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "bytes");
      const lock = resolve(sandbox.home, ".ndea", "locks", "install.lock");
      mkdirSync(dirname(lock), { recursive: true });
      writeFileSync(lock, `${process.pid}\n`);

      const result = await runInstaller(sandbox, ["v0.4.2"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain(`install/update lock held by PID ${process.pid}`);
    }),
  );

  test(
    "reclaims a lock left behind by a dead process",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "bytes");
      const lock = resolve(sandbox.home, ".ndea", "locks", "install.lock");
      mkdirSync(dirname(lock), { recursive: true });
      // Above the default pid_max on Linux and macOS, so it cannot be running.
      writeFileSync(lock, "4194305\n");

      expect((await runInstaller(sandbox, ["v0.4.2"])).exitCode).toBe(0);
      expect(readlinkSync(launcher(sandbox))).toBe(installedBinary(sandbox, "v0.4.2"));
    }),
  );
});

describe("install.sh PATH guidance", () => {
  test(
    "points at the shell rc matching $SHELL when the install dir is not on PATH",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "bytes");

      const result = await runInstaller(sandbox, ["v0.4.2"], { SHELL: "/usr/bin/fish" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("config.fish");
      expect(result.output).toContain("fish_add_path");
    }),
  );

  test(
    "stays quiet when the install dir is already on PATH",
    withSandbox(async (sandbox) => {
      serveAsset(sandbox, "v0.4.2", "bytes");
      const dest = resolve(sandbox.home, ".local", "bin");

      const result = await runInstaller(sandbox, ["v0.4.2"], {
        PATH: `${sandbox.stubs}:${dest}:${process.env.PATH ?? ""}`,
      });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("is not on PATH");
    }),
  );
});
