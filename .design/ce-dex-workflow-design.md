# CE × dex Workflow — Design

Status: DRAFT for review (2026-06-25). Investigated, not built. Do not modify any skill files until the shape below is confirmed.

## What this is

A *generalizable compound-engineering workflow* that captures the multi-agent
orchestration scaffold the main session has been hand-rolling — **investigate
(parallel readers) → implement (gated) → adversarially-verify** — and threads
`/dex` issue tracking + `/dex-plan` planning through it, while reusing the
already-installed `/ce-brainstorm` for the front of the funnel.

The scaffold is the asset. It is anchored to a git worktree, gated on
`vp check` (0 errors) + `bun test`, and ends with an adversarial-verify pass
*before* a unit of work is allowed to close. That verify step already caught a
real reactivity bug an implementer missed, so it is load-bearing, not ceremony.

## What exists today (verified)

- `~/.claude/skills/ce-brainstorm/` — installed. Produces a requirements doc at
  `docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md`, then a Phase 4 handoff
  menu whose recommended next step is `ce-plan`.
- `~/.claude/skills/dex/` + `~/.claude/skills/dex-plan/` — installed (symlinks
  into `.agents/skills/`). dex is a 3-level tracker: **Epic → Task → Subtask**
  (max depth 3). Storage is per-repo `<git-root>/.dex/tasks/{id}.json`. CLI is
  `dex` or, when not on PATH (the current state), `npx @zeeg/dex`. Tasks carry
  `name` / `description` / `result`, support `--blocked-by` and `--parent`, and
  `complete` *requires verification evidence* in `--result`.
- **`ce-plan` and `ce-work` are NOT installed.** ce-brainstorm hands off to
  them, but they don't exist on this machine. This is the central gap the design
  must work around: the canonical CE middle+end are absent, and dex + the
  orchestration scaffold are the natural things to fill that gap with.
- No `.claude/workflows/` directory exists anywhere (`~/.claude` or any
  worktree) — the "reusable Workflow-tool JS script" option would be net-new
  infrastructure with no precedent in this setup.
- Existing `.dex/` stores live in `nd-embedding-atlas/` and
  `nd-embedding-atlas.feat-node-graph-tracer/` — the user already tracks work in
  dex per-worktree.

### Relevant user taste (from memory)

`feedback_dex_vs_linear.md`: the user wants **clean separation** between dex
(Claude's in-session scratch tracker) and Linear (their persistent source of
truth), and explicitly does **not** want two-way sync wrappers. That memo is
about the dex↔Linear axis, *not* dex↔CE, so it does not forbid coupling dex into
this workflow. But it is a strong signal about taste: **prefer thin, one-way,
manual-choice coupling over heavy bidirectional machinery.** The design honors
that — dex is written to at phase boundaries, nothing syncs back out to Linear,
and dex stays optional.

## Proposed shape

**Recommendation: (a) a new global `/ce-*` skill — `ce-orchestrate` — plus a
thin `ce-plan`/`ce-work` shim, NOT a `.claude/workflows/*.js` script.**

Rationale:

- The thing the user most wants captured is the *orchestration scaffold*. A
  skill is a markdown command the orchestrator (main agent) reads and then
  executes using the tools it already has — `Agent` for parallel readers, the
  worktree tools, `Bash` for gates. That is exactly how the session has been
  hand-rolling it. A skill encodes the recipe without inventing a new runtime.
- A `.claude/workflows/*.js` script (the Workflow tool) is a real option and is
  more *deterministic* (it hardcodes the phase machine), but: (1) there is zero
  precedent for it in this setup, (2) it is repo-local, so it would not be
  "generalizable across projects" without copying, and (3) it freezes the
  per-task content (investigate prompts, schemas) into code, which is the part
  that *should* stay fluid per run. Skills are global (`~/.claude/skills/`),
  re-used across every worktree, and let the orchestrator fill in per-task
  content each run. That matches "generalizable scaffold, per-task fill-in"
  better than a frozen script.
- (c) "just chain the existing skills" is insufficient on its own because the
  chain is broken — `ce-plan`/`ce-work` don't exist. We have to supply the
  middle and end regardless.

So the build (later, after confirmation) is:

1. **`ce-orchestrate`** (new global skill) — the reusable scaffold: worktree
   anchor, parallel-investigate, gated-implement, adversarial-verify, gates.
   This is the generalizable core.
2. **`ce-plan`** (new thin global skill) — bridges ce-brainstorm's handoff to
   dex. It is essentially `/dex-plan` with a CE-aware wrapper: take the
   requirements doc, produce a dex epic + child issues, and emit the
   `origin:`-linked plan artifact ce-orchestrate consumes.
3. **`ce-work`** (new thin global skill) — invokes `ce-orchestrate` for a single
   dex issue. "Build it now (skip planning)" from ce-brainstorm lands here.

ce-orchestrate is the load-bearing new artifact; ce-plan and ce-work are thin
adapters so the existing ce-brainstorm handoff menu resolves instead of dangling.

## Phase → artifact → dex touchpoint

| Phase | Skill | Artifact produced | dex touchpoint |
|---|---|---|---|
| 0. Idea | — | (none) | — |
| 1. Brainstorm | `ce-brainstorm` (exists) | `docs/brainstorms/<date>-<topic>-requirements.md` | **none** — brainstorm stays dex-free; nothing to track until scope is set |
| 2. Plan | `ce-plan` → `dex-plan` | dex epic + child issues; plan doc `docs/plans/<date>-<topic>-plan.md` with `origin:` → requirements doc | **CREATE epic + child issues.** One issue per implementable unit. Issue `description` = the full per-issue spec (what/why/how/done-when) |
| 3. Implement (per issue) | `ce-orchestrate` (new) | code on the anchored worktree; per-issue commit | **mark issue in-progress** at start (note in result-draft); investigate → implement → verify all scoped to one dex issue |
| 4. Adversarial-verify (per issue) | `ce-orchestrate` (new) | verify report folded into the dex `--result` | **gate before close.** Issue cannot close until `vp check` = 0 + `bun test` green + adversarial reader signs off. Verification evidence goes in `--result` (dex requires it) |
| 5. Close issue | `ce-orchestrate` → `dex` | — | **`dex complete <id> --result "<evidence>" --commit <sha>`** (or `--no-commit` for non-code) |
| 6. Close epic | — | — | **`dex complete <epic-id>`** with a roll-up result once all children done |

The arc: idea → (ce-brainstorm) requirements doc → (ce-plan/dex-plan) **dex epic
+ issues** → (ce-orchestrate, per issue) investigate → implement → adversarial-
verify → **close dex issue with evidence** → close epic.

### Linkage / `origin:`

- requirements doc is canonical product intent.
- plan doc carries `origin: docs/brainstorms/<...>-requirements.md` in front-matter.
- each dex issue `description` names the plan doc + requirements doc by
  **repo-relative path** (per ce-brainstorm's portability rule), and which plan
  section it implements.
- Per the dex skill's "tasks are ephemeral" rule, **dex IDs never leak into
  commits/PRs/docs.** Commits describe the work; if a dex task is linked to a
  GitHub issue, `Fixes #N` (root) / `Refs #N` (subtask) is used instead. The
  `origin:` chain lives in the durable docs, not in dex IDs.

## The reusable scaffold (what "generalizable" means)

`ce-orchestrate` is parameterized by a **task** (one dex issue, or an inline
ad-hoc task when dex is skipped). Fixed structure, per-task fill-in:

**Fixed (the scaffold):**
1. **Worktree anchor** — every run binds to one git worktree; all agents and
   gates operate there. (EnterWorktree / explicit path. The session's hand-rolled
   version anchored to a specific worktree — keep that.)
2. **Investigate** — dispatch N parallel *read-only* reader agents (the `Explore`
   / general-purpose agents, run concurrently in one message). They return
   conclusions + `file:line` pointers, not file dumps.
3. **Implement** — a single implementer agent (or the orchestrator) applies the
   change. **Gated:** does not proceed to verify until it self-reports done.
4. **Adversarial-verify** — a *fresh-context* reader agent that did NOT write the
   code tries to break the claim. Mirrors ce-brainstorm's Phase 2.6 "fresh
   verifier replaces self-grading" principle. This is the step that caught the
   reactivity bug.
5. **Gates** — `vp check` must be 0 errors AND `bun test` must pass before the
   unit is allowed to close. Hard gate, not advisory.

**Per-task fill-in (each run):**
- the investigate prompts (what to read, what question to answer)
- the implement spec (pulled from the dex issue `description`)
- the adversarial-verify focus (what's most likely to be subtly wrong)
- any task-specific schema / acceptance criteria

This is the "scaffold with per-task content" split the brief asks for: the
phases, worktree anchor, gates, and verify-before-done are constant; the prompts
and schemas are filled in from the dex issue each run.

## Graceful degradation

1. **dex unavailable** (`dex` not on PATH — the current state):
   - First, fall back to `npx @zeeg/dex` (the dex skill's documented fallback).
   - If npx/dex genuinely can't run: ce-orchestrate still runs the scaffold
     against an **inline task list** (built-in TodoWrite/Task tools) instead of
     dex issues. The investigate→implement→verify→gate loop is unchanged; only
     the persistence layer drops. The plan doc still gets written. State this
     downgrade once, don't fail.
2. **Task too small for an epic:** ce-plan creates a **single dex task** (no
   children) — exactly dex-plan's own "no breakdown" path. For a truly trivial
   change, skip dex entirely (dex skill: "skip when work is a single atomic
   action") and run ce-orchestrate inline. Match dex ceremony to scope, same as
   ce-brainstorm matches doc ceremony to scope.
3. **No requirements doc** (user jumps straight to "build this"): ce-orchestrate
   can be invoked directly with an inline task spec — brainstorm + plan docs are
   optional inputs, not hard prerequisites. The scaffold + gates still apply.
4. **`ce-plan`/`ce-work` not yet built:** until they're built, ce-brainstorm's
   handoff menu options that name them will dangle. Interim: the orchestrator
   invokes `/dex-plan` directly on the requirements doc, then runs the scaffold
   by hand. (This is the bootstrap state — building the two thin shims removes
   it.)

## Open Decisions

1. **Shape** — confirm: new global `ce-orchestrate` skill (+ thin `ce-plan` /
   `ce-work` shims), rather than a repo-local `.claude/workflows/*.js` script.
   Default chosen: skill. Fork if you actually want the deterministic JS state
   machine despite no precedent.
2. **Global skill vs repo workflow** — confirm global (`~/.claude/skills/`, used
   across every worktree) vs repo-local. Default: global, because
   "generalizable" = cross-project. Repo-local only if you want this scoped to
   nd-embedding-atlas alone.
3. **How tightly dex couples** — three settings:
   (a) *thin/optional* (recommended): dex written at phase boundaries only, no
   sync-back, degrades to TodoWrite when absent;
   (b) *required*: every run must create a dex epic, hard-fail without dex;
   (c) *dex-first*: dex issue is the only entry point and ce-brainstorm/ce-plan
   feed it. Default chosen: (a), to match the user's "clean separation, no heavy
   sync" taste from the Linear memo.
4. **Build `ce-plan` + `ce-work` as thin shims, or vendor the real upstream CE
   skills?** ce-brainstorm references full upstream `ce-plan`/`ce-work` that
   aren't installed. Option: write minimal dex-aware shims (fast, fits our
   pipeline) vs. obtain/port the real upstream skills and bolt dex on (heavier,
   more faithful to CE). Default chosen: thin shims, because the orchestration
   scaffold (not CE-canonical planning) is what the user asked to capture.
5. **dex epic granularity** — one epic *per brainstorm* (epic = the feature) vs
   one epic *per worktree/branch* (epic = the whole spike). Default: per
   brainstorm/feature, matching dex's Epic→Task→Subtask intent and keeping the
   `origin:` chain 1:1 with the requirements doc.
6. **Where adversarial-verify evidence lives** — folded into the dex `--result`
   (recommended; dex already demands evidence) vs a separate verify report
   file. Default: in `--result`, to avoid an extra artifact.
