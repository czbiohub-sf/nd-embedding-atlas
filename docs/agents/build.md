# Build, native pieces, releases

Reference for `apps/ndea/scripts/`, the dev server, and distribution.

## Dev server

- `vp run dev` = `bun x --bun portless run bun apps/ndea/scripts/dev.ts` →
  `ndea view --dev`: one Bun process serves the frontend through Bun's dev
  server (HMR, browser console echoed), the API, `/data/query`, `/ws`, `/mcp`.
  portless names it `https://ndea.localhost` (a linked worktree gets
  `https://<last branch segment>.ndea.localhost`); its first run starts the
  proxy (HTTPS on :443, sudo and a CA trust once). `PORTLESS=0 vp run dev`
  serves `http://localhost:5055`. `--fixture` swaps in a synthetic dataset.
- Run it from the repo root: the root `bunfig.toml` `[serve.static]` plugin
  (`apps/ndea/scripts/frontend-plugin.ts`: Tailwind + TypeGPU) is the same one
  `build.ts` passes to `Bun.build`.
- `react-refresh` is a root devDependency only so Bun's dev server enables Fast
  Refresh (oven-sh/bun#40245).
- A Tailwind class first used after the dev server started may stay unstyled
  until a restart; production builds are unaffected.

## The binary

- `vp run build`: cached `build:addon` and `build:zarr-ext`, then a compile
  that always runs (`--target=<bun target>`). One full-stack executable: the
  frontend bundle, ESM bytecode ordered by `apps/ndea/scripts/bytecode-order/*.order`
  (`vp run bytecode-order` re-records them), embedded sourcemaps. Direct
  `bun build --compile` skips the frontend plugins.
- `duckdb.node` embeds in the binary, so each platform builds natively (no
  cross-compiles). On darwin-arm64, `scripts/build-duckdb-addon.ts` compiles
  duckdb-node-neo's bindings against the release's
  `duckdb-static-libs-osx-arm64.tar.gz` (version from the bindings'
  `fetch_libduckdb.py`, cached in `apps/ndea/.duckdb-addon-cache/`). DuckDB 2
  links nothing implicitly: a generated static initializer registers
  core_functions, parquet, json, icu, httplib, and loadable_extensions through
  their describe functions, without which `LOAD` fails. Other targets embed
  libduckdb for `preload-libduckdb.ts`; on Windows the library is `duckdb.dll`
  (`libduckdb-cache.ts` owns the name).

## duckdb-zarr extension

`scripts/build-zarr-extension.ts` (`vp run build:zarr-ext`; `test`, `build`,
`dev`, `ndea`, `bench:ingest` run it on demand) fetches duckdb-zarr at the
commit `server/zarr-extension.ts` pins, pins its duckdb-rs crate to the
installed DuckDB (`v2.0.0` → `1.20000.x`), runs `cargo build --release` in the
source tree, and appends the metadata footer in Bun. DuckDB 2 accepts
unstable-ABI extensions only through a `zarr_init_c_api_v2` entrypoint
duckdb-zarr lacks, so the footer declares the stable C API its entrypoint
requests (`C_STRUCT`, `v1.2.0`). Rebuild on every DuckDB bump; CI pins Rust
1.99.0.

## Updates and installs

- Standalone installs live under `~/.ndea/versions/<tag>/ndea`; `ndea self
  update` repoints `~/.local/bin/ndea` atomically and keeps only the active
  version. Mise-managed installs update through mise only.
- Compiled binaries run Crust's `updateNotifier` against `registry/ndea` on
  the docs site (dist-tags written by `docs.yml`; `release.yml` redeploys).
- Windows ships `ndea-windows-x64.exe` via `scripts/install.ps1` to
  `%LOCALAPPDATA%\ndea\bin`; `ndea self update` exits early on `win32`, and
  re-running the installer upgrades.
- `vp run release:version` writes `apps/ndea/package.json`'s version into
  `src/env/version.ts` before tagging.
