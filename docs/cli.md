---
icon: lucide/terminal
---

# CLI reference

Every `ndea` subcommand, flag, environment variable, and channel.

Walkthroughs live in [Getting started](index.md). Dev-side commands (`vp run dev`, `vp run gen`, …) live in [Contributing](contributing.md).

## Synopsis

```
ndea [paths...]                                  # default — equivalent to `ndea view`
ndea view [paths...] [options]
ndea install [options]
ndea update [options]
ndea rollback
ndea completions <bash|zsh|fish>
ndea complete -- <args...>                       # internal — called by completion scripts
ndea --help | --version
```

## Default subcommand fall-through

When the first positional isn't a known subcommand, `ndea` routes to `view`. These two are equivalent:

```
ndea path/to/data.zarr
ndea view path/to/data.zarr
```

With no positional and `NDEA_DATASET` set, `view` reads that path. `vp run dev` uses this to inject the dataset across orchestrated dev tasks.

## `ndea view`

Open one or more zarr stores (or a YAML project config) in the dashboard.

### Arguments

| Name     | Type              | Description                                 |
| -------- | ----------------- | ------------------------------------------- |
| `paths…` | one or more paths | Zarr stores or a single YAML project config |

A single `.yaml` / `.yml` path is parsed as a multi-dataset project config (see [Preparing your data](preparing-your-data.md)).

### Options

| Option                 | Type    | Default     | Description                                                            |
| ---------------------- | ------- | ----------- | ---------------------------------------------------------------------- |
| `--port <port>`        | integer | `5055`      | TCP port for the local server                                          |
| `--host <host>`        | string  | `localhost` | Hostname to bind                                                       |
| `--no-open`            | boolean | `false`     | Do not auto-open the browser                                           |
| `--no-static`          | boolean | `false`     | Do not serve the bundled frontend (dev mode — frontend served by Vite) |
| `--obs-columns <list>` | string  | all columns | Comma-separated subset of obs columns to load                          |

`--port` accepts integers in `[1, 65535]`.

## `ndea install`

Stage B of the self-installer. `install.sh` invokes it after downloading the binary; rarely run by hand.

### Options

| Option             | Type    | Default        | Description                                                    |
| ------------------ | ------- | -------------- | -------------------------------------------------------------- |
| `--from-bootstrap` | boolean | `false`        | Marks the call as originating from `install.sh` (Stage A)      |
| `--bin-dir <dir>`  | string  | `~/.local/bin` | Override install destination (`NDEA_BIN_DIR` takes precedence) |
| `--force`          | boolean | `false`        | Overwrite an existing binary without prompting                 |

Refuses to run from `bun run` (i.e. uncompiled) unless `--from-bootstrap` is set.

## `ndea update`

Download the latest release for a channel, verify the checksum, stage it as `<self>.pending`. The swap applies on the next `ndea` invocation.

### Options

| Option                | Type                                              | Default  | Description                                |
| --------------------- | ------------------------------------------------- | -------- | ------------------------------------------ |
| `--channel <channel>` | `stable` \| `latest` \| `pre-release` \| `canary` | `stable` | Release channel to resolve                 |
| `--force`             | boolean                                           | `false`  | Re-install even when already on the target |

Refuses to run uncompiled (i.e. via `bun run`).

State lives at `~/.ndea/pending-update`. The applier runs at the start of every `ndea` command except `install` / `update` / `rollback` — those own the install lifecycle and skip it to avoid a swap race.

## `ndea rollback`

Restore the previous binary from `<self>.bak`.

`ndea update` keeps one level of history: it renames the running binary to `.bak` before applying the staged `.pending`. `rollback` undoes that swap.

No options. Refuses to run uncompiled.

## `ndea completions`

Emit shell completion scripts.

### Arguments

| Name  | Type                      | Description       |
| ----- | ------------------------- | ----------------- |
| shell | `bash` \| `zsh` \| `fish` | Shell to emit for |

### Usage

```bash
# bash / zsh — load on demand
source <(ndea completions bash)
source <(ndea completions zsh)

# fish — drop into the completions dir
ndea completions fish > ~/.config/fish/completions/ndea.fish
```

`view`'s positional completion filters to `*.zarr` directories and `*.yaml` / `*.yml` files.

## Environment variables

| Variable                   | Consumer               | Default        | Description                                                  |
| -------------------------- | ---------------------- | -------------- | ------------------------------------------------------------ |
| `NDEA_DATASET`             | `view`                 | unset          | Path forwarded as a positional when none is given            |
| `NDEA_NO_OPEN`             | `view`                 | unset          | When `1`, equivalent to passing `--no-open`                  |
| `NDEA_NO_STATIC`           | `view`                 | unset          | When `1`, equivalent to passing `--no-static`                |
| `NDEA_CHANNEL`             | `update`, `install.sh` | `stable`       | Default release channel                                      |
| `NDEA_VERSION`             | `install.sh`           | `latest`       | Pin first install to a specific tag (e.g. `v0.1.0-rc.1`)     |
| `NDEA_BIN_DIR`             | `install`              | `~/.local/bin` | Install destination                                          |
| `NDEA_HOME`                | all                    | `~/.ndea`      | State directory (logs, locks, backup, pending-update marker) |
| `NDEA_DISABLE_AUTOUPDATER` | all                    | unset          | When `1`, the pending-update applier is skipped at startup   |

## Release channels

| Channel       | Resolves to                                  | Cadence                                                  |
| ------------- | -------------------------------------------- | -------------------------------------------------------- |
| `stable`      | latest semver-tagged release (e.g. `v0.1.0`) | Manual; cut from `main` when ready                       |
| `latest`      | alias for `stable`                           | Same as `stable`                                         |
| `pre-release` | latest active alpha / beta / rc tag          | Manual; absent between cuts (manifest pointer is `null`) |
| `canary`      | rolling `canary` tag                         | Automatic on every push to `main`                        |

[`manifest.json`](https://github.com/czbiohub-sf/nd-embedding-atlas/blob/main/manifest.json) maps each channel to a git tag. `ndea update` fetches it from `raw.githubusercontent.com` at update time. Ops can hand-edit the manifest to roll a channel back without re-cutting a release.

## State directory layout

`~/.ndea/` (override with `NDEA_HOME`):

```
~/.ndea/
  current-version       # Plain text: "<tag>\n<sha256>\n"
  pending-update        # JSON marker; present only when an update is staged
  locks/
    install.lock        # PID file backing the install/update mutex
  logs/                 # Reserved for future telemetry / install traces
```

The current binary lives at `$NDEA_BIN_DIR/ndea`; the previous version (if any) at `$NDEA_BIN_DIR/ndea.bak`.

## Exit codes

| Code  | Meaning                                                             |
| ----- | ------------------------------------------------------------------- |
| `0`   | Success                                                             |
| `1`   | General error (missing argument, fatal startup, lock contention, …) |
| `130` | Interrupted (`Ctrl-C` during a long-running command)                |
