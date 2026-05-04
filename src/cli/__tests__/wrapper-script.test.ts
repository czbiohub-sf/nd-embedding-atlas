/**
 * Sanity tests for the wrapper script content. install.sh and update.ts
 * both extract this string via the binary's hidden `__write-wrapper`
 * subcommand, so there's only one source of truth — but we still pin the
 * essential clauses so a refactor doesn't accidentally break the
 * NDEA_LAUNCHER / LD_LIBRARY_PATH / exec contract that the rest of the
 * CLI depends on.
 */

import { describe, expect, test } from "bun:test";
import { WRAPPER_SCRIPT_CONTENT } from "../lib/wrapper-script.ts";

describe("wrapper-script content invariants", () => {
  test("exports NDEA_LAUNCHER (used by update / rollback / doctor / gc)", () => {
    expect(WRAPPER_SCRIPT_CONTENT).toContain('export NDEA_LAUNCHER="$0"');
  });

  test("sets LD_LIBRARY_PATH from script directory", () => {
    expect(WRAPPER_SCRIPT_CONTENT).toContain('export LD_LIBRARY_PATH="${dir}');
  });

  test("exec's ndea.bin (not bun) — so process.execPath is the binary", () => {
    expect(WRAPPER_SCRIPT_CONTENT).toContain('exec "${dir}/ndea.bin"');
  });

  test("resolves $0 via realpath (handles PATH-symlink chains)", () => {
    expect(WRAPPER_SCRIPT_CONTENT).toContain('realpath "$0"');
  });
});
