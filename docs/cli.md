---
icon: lucide/terminal
---

# CLI reference

Complete description of the `ndea` command surface — subcommands, options, environment variables, and channels.

For workflow-oriented walkthroughs, see [Getting started](index.md). For dev-side commands (`vp run dev`, `vp run gen`, …) see [Contributing](contributing.md).

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

When the first positional argument is not a known subcommand, `ndea` routes the invocation to `view`. These two commands are equivalent:

```
ndea path/to/data.zarr
ndea view path/to/data.zarr
```

If no positional is provided and `NDEA_DATASET` is set, the value of that variable is forwarded to `view`. This is the path used by `vp run dev` to inject the dataset argument across the orchestrated dev tasks.

## `ndea view`

Open one or more zarr stores (or a YAML project config) in the dashboard.

### Arguments

| Name     | Type              | Description                                 |
| -------- | ----------------- | ------------------------------------------- |
| `paths…` | one or more paths | Zarr stores or a single YAML project config |

A single path with a `.yaml` / `.yml` extension is parsed as a multi-dataset project config (see [Preparing your data](preparing-your-data.md)).

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

Stage B of the self-installer. Invoked by `install.sh` after the binary is downloaded; not normally run by hand.

### Options

| Option             | Type    | Default        | Description                                                    |
| ------------------ | ------- | -------------- | -------------------------------------------------------------- |
| `--from-bootstrap` | boolean | `false`        | Marks the call as originating from `install.sh` (Stage A)      |
| `--bin-dir <dir>`  | string  | `~/.local/bin` | Override install destination (`NDEA_BIN_DIR` takes precedence) |
| `--force`          | boolean | `false`        | Overwrite an existing binary without prompting                 |

Refuses to run from `bun run` (i.e. uncompiled) unless `--from-bootstrap` is set.

## `ndea update`

Download the latest release for a channel, verify its checksum, and stage it as `<self>.pending`. The swap is applied on the next `ndea` invocation.

### Options

| Option                | Type                                              | Default  | Description                                    |
| --------------------- | ------------------------------------------------- | -------- | ---------------------------------------------- |
| `--channel <channel>` | `stable` \| `latest` \| `pre-release` \| `canary` | `stable` | Release channel to resolve                     |
| `--force`             | boolean                                           | `false`  | Update even when already on the target version |

Refuses to run from `bun run` (i.e. uncompiled). The check is skipped when `NDEA_CHANNEL` is set in the environment to the same value.

The pending-update state lives at `~/.ndea/pending-update`. The applier runs at the start of every `ndea` invocation except `install` / `update` / `rollback` (which own the install lifecycle and must not have a swap race).

## `ndea rollback`

Restore the previous binary from `<self>.bak`.

`ndea update` preserves one level of history: before applying a staged `.pending`, the existing binary is renamed to `.bak`. `rollback` undoes that swap.

No options. Refuses to run from `bun run`.

## `ndea completions`

Generate shell completion scripts.

### Arguments

| Name  | Type                      | Description               |
| ----- | ------------------------- | ------------------------- |
| shell | `bash` \| `zsh` \| `fish` | Shell flavour to emit for |

### Usage

```bash
# bash / zsh — load on demand
source <(ndea completions bash)
source <(ndea completions zsh)

# fish — drop into the completions dir
ndea completions fish > ~/.config/fish/completions/ndea.fish
```

Completions for `ndea view` positional paths filter to `*.zarr` directories and `*.yaml` / `*.yml` files.

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

The mapping from channel name to git tag lives in [`manifest.json`](https://github.com/czbiohub-sf/nd-embedding-atlas/blob/main/manifest.json) at the repo root, fetched from `raw.githubusercontent.com` at update time. Ops can hand-edit the manifest to roll back a channel without re-cutting a release.

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

The currently-installed binary is at `$NDEA_BIN_DIR/ndea`; its previous version (if any) at `$NDEA_BIN_DIR/ndea.bak`.

## Exit codes

| Code  | Meaning                                                             |
| ----- | ------------------------------------------------------------------- |
| `0`   | Success                                                             |
| `1`   | General error (missing argument, fatal startup, lock contention, …) |
| `130` | Interrupted (`Ctrl-C` during a long-running command)                |
