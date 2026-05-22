// Preload the embedded libduckdb shared library before @duckdb/node-api
// evaluates.
//
// The compiled binary embeds libduckdb into $bunfs/ rather than shipping
// it as a sidecar next to the binary. duckdb.node's link-time rpath
// (@loader_path on macOS, $ORIGIN on Linux) can't find the dylib at its
// extraction location, so we dlopen a materialized copy up front. dyld /
// ld.so then match duckdb.node's `@rpath/libduckdb.<ext>` (macOS) /
// SONAME (Linux) dependency against the already-loaded image instead of
// going to disk.
//
// In dev (`bun run src/cli/index.ts`) the generated stub exports `null`
// and this module is a no-op — the binding loads its sibling libduckdb
// from node_modules/@duckdb/node-bindings-<plat>/ normally.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { dlopen, FFIType } from "bun:ffi";
import { LIBDUCKDB_EMBEDDED_PATH } from "./__generated-libduckdb.ts";
import { VERSION } from "../version.ts";

if (LIBDUCKDB_EMBEDDED_PATH !== null) {
  const ext = process.platform === "darwin" ? "dylib" : process.platform === "linux" ? "so" : "dll";
  // ~/.cache/ndea/<version>/libduckdb.<ext> — version-scoped so old
  // copies don't leak across upgrades, persistent across OS tmp cleans.
  // Honours XDG_CACHE_HOME if set; falls back to ~/.cache.
  const cacheRoot = process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache");
  const cacheDir = resolve(cacheRoot, "ndea", VERSION);
  const dylibPath = resolve(cacheDir, `libduckdb.${ext}`);

  if (!existsSync(dylibPath)) {
    mkdirSync(cacheDir, { recursive: true });
    // Top-level await blocks module evaluation until the dylib is on
    // disk. Bun supports TLA in entry modules.
    writeFileSync(dylibPath, await Bun.file(LIBDUCKDB_EMBEDDED_PATH).bytes());
  }

  // Use bun:ffi's dlopen rather than process.dlopen — the latter walks
  // the loaded image for `napi_register_module_v1` and throws when the
  // dylib isn't a Node addon (which libduckdb isn't). bun:ffi's dlopen
  // calls the OS dlopen() directly and keeps the Library alive for the
  // process lifetime, which is all we need.
  //
  // Side effect: dyld (macOS) / ld.so (Linux) registers the loaded
  // image by its install_name / SONAME. When duckdb.node is required
  // shortly after, its dependency on `@rpath/libduckdb.dylib` (macOS)
  // or `libduckdb.so` (Linux) resolves against the already-loaded
  // image — rpath search never runs.
  //
  // bun:ffi requires at least one declared symbol; we pick a stable C
  // symbol from the DuckDB C API. We never call it — declaring it is
  // sufficient to keep the Library alive and the underlying image
  // loaded.
  dlopen(dylibPath, {
    duckdb_library_version: { args: [], returns: FFIType.cstring },
  });
}
