# Repository health hotspot refactors — design plan

## Context

Fallow reports a B health grade (73.5/100) across 511 analyzed files. The main maintainability risk is 180 over-threshold functions. This plan targets the three highest-risk production hotspots:

- `startup()` in `apps/ndea/src/cli/startup.ts`: cyclomatic 65, cognitive 101, 470 lines, CRAP 4290.
- `routeApi()` in `apps/ndea/src/server/app.ts`: cyclomatic 63, cognitive 69, 166 lines, CRAP 920.3.
- `NdGraphNodeInner()` in `apps/ndea/src/frontend/core/workspace/canvas/NdGraphNode.tsx`: cyclomatic 66, cognitive 105, 342 lines, 26 hooks, CRAP 1006.9.

Scope decision: refactor these three hotspots only. Dead-code and dependency cleanup are explicitly out of scope. The completed work will be committed directly to the current branch rather than split into separate PRs.

## Approach

Refactor along existing responsibility boundaries without changing behavior, public APIs, route semantics, or the startup failure policy:

1. Turn `startup()` into a short, linear coordinator. Extract dataset opening/preparation, ingest-store creation, server-session preparation, server lifecycle, and console presentation into internal startup modules. Keep the current phase order, progress messages, cache behavior, pre-warm-before-ready guarantee, browser opening, signal handling, and `process.exit` behavior.
2. Move API dispatch out of `app.ts` into an internal `api-router.ts`. Use an explicit ordered list of small route-family dispatchers rather than a generic routing dependency or a large declarative table. Each dispatcher returns `Response | Promise<Response> | null`; `null` means “not matched.” Preserve the current 404-on-method-mismatch behavior and precedence constraints for `/api/obs/batch`, obs detail, embedding status, and export status.
3. Turn `NdGraphNodeInner` into a composition layer. Extract always-called workspace/telemetry subscriptions into `useNdGraphNodeModel`, resize lifecycle into `useNdGraphNodeResize`, and render-only branches into focused components/helpers. Keep selector granularity, unconditional hook order, xyflow Handle mounting, node-element registration, form/size invalidation, and existing frame/body/action components.
4. Add narrow characterization tests for extracted pure decisions and route behavior. Do not introduce a new test framework, broad snapshots, or unrelated cleanup.

Success means all three targeted functions fall below the configured Fallow thresholds (cyclomatic 20, cognitive 15, CRAP 30), extracted helpers do not become replacement hotspots, and focused/full verification remains green.

## Files to modify

Critical existing paths:

- `apps/ndea/src/cli/startup.ts` — retain the public `startup(config)` entrypoint as the coordinator.
- `apps/ndea/src/server/app.ts` — retain Bun transport, WebSocket, CORS, top-level data/plugin/plate/static routing, and `createApp()`.
- `apps/ndea/src/server/__tests__/app.test.ts` — characterize API precedence, method mismatch, and unknown-route behavior through the real server.
- `apps/ndea/src/frontend/core/workspace/canvas/NdGraphNode.tsx` — retain the exported memoized xyflow node and compose extracted pieces.

Expected new internal modules:

- `apps/ndea/src/cli/startup/datasets.ts` — loaded-dataset type, opening, embedding discovery, dataset/spatial preparation.
- `apps/ndea/src/cli/startup/ingest.ts` — ingest strategy selection, chunked/streaming/eager initializers, cache reuse/rebuild, query-session creation.
- `apps/ndea/src/cli/startup/session.ts` — plate metadata, annotation restoration, and `ServerSession`/metadata construction.
- `apps/ndea/src/cli/startup/server.ts` — plugin bootstrap, Bun server start/error handling, embedding pre-warm, browser open, and graceful shutdown registration.
- `apps/ndea/src/cli/startup/output.ts` — ANSI formatting and banner/progress/ready output so orchestration does not accumulate presentation branches.
- `apps/ndea/src/cli/__tests__/startup.test.ts` — pure strategy/metadata ordering characterization; no real browser or signal manipulation.
- `apps/ndea/src/server/api-router.ts` — API route context and ordered route-family dispatchers.
- `apps/ndea/src/frontend/core/workspace/canvas/useNdGraphNodeModel.ts` — subscriptions, derived presentation state, and resize hook.
- `apps/ndea/src/frontend/core/workspace/canvas/nd-graph-node-model.test.ts` — pure count/LED/body-mode decision tests.

Exact file boundaries may be collapsed if an extracted module would contain only a trivial pass-through; the constraints are short focused functions and one-way dependencies back toward existing domain handlers/utilities.

## Reuse

- Existing startup helpers in `apps/ndea/src/cli/startup.ts`: `discoverObsmKeys`, `readPlateMetaForDatasets`, `buildPlateMetadata`, `resolveAnnotationsSidecarPath`, and `sortObsmKeys` should move to the phase that owns them rather than be reimplemented.
- Existing ingest utilities in `apps/ndea/src/server/ingest-cache.ts` and zarr ingestion functions from `@ndea/zarr`.
- Existing route handlers under `apps/ndea/src/server/routes/`; refactoring reorganizes dispatch and does not duplicate route logic.
- `routeRequest`, `withCors`, and `extractPathParam` from `apps/ndea/src/server/app.ts`; `extractPathParam` moves with API routing while transport helpers remain in `app.ts`.
- `NdNodeFrame`, `NdHandle`, workspace selectors, telemetry selectors, and `node-extras` already used by `NdGraphNode.tsx`.
- `BodySocket`, `HeaderSocket`, `resolveNodeForm`, `resolveNodeSize`, `workspaceNodeSize`, and `useNodeCount`; the refactor must not add parallel state or duplicate these policies.
- Bun’s existing test runner and setup patterns in `apps/ndea/src/server/__tests__/app.test.ts`.

## Steps

- [ ] Record baseline metrics for `startup`, `routeApi`, and `NdGraphNodeInner`, plus the focused commands used to reproduce them.
- [ ] Add characterization coverage before moving code: ingest-strategy cases, route precedence/method mismatch/404 behavior, and pure graph-node presentation decisions.
- [ ] Extract startup dataset discovery/preparation while preserving AnnData/MuData validation, obsm ordering, multi-dataset constraints, and console/error behavior.
- [ ] Extract ingest/query-session creation while preserving eager/stream/chunked selection, local cache keys, stale-cache rebuild, hidden columns, and var-table initialization.
- [ ] Extract server-session/metadata preparation while preserving annotation restoration, plate metadata, plugin diagnostics, and dataset-channel semantics.
- [ ] Extract server lifecycle/output helpers while preserving port-collision diagnostics, embedding pre-warm before “Ready,” dev URLs, browser suppression, signal handlers, annotation flush, and resource close order.
- [ ] Move API routing into ordered route-family functions and keep `app.ts` responsible for transport, WebSocket upgrades, CORS, top-level routes, errors, and static fallback.
- [ ] Reduce repeated server-test setup with an existing-file helper only where it improves route characterization; do not mix unrelated test cleanup into the refactor.
- [ ] Extract graph-node subscriptions and resize behavior into unconditional hooks; keep the same individual store selectors to avoid widening rerender scope.
- [ ] Extract unresolved/proxy/body/actions/ports/footer rendering into small render-only units while preserving element registration, Handle presence/position, count policy, LED state, fullscreen/staged behavior, and memoized export.
- [ ] Run focused verification after each hotspot, then the complete repository checks and build.
- [ ] Rerun Fallow complexity for the changed files; continue splitting only if a new helper exceeds the configured thresholds.
- [ ] Commit the completed refactor and tests to the current branch.

## Verification

- Run focused Bun tests for the new startup characterization, graph-node model, and `apps/ndea/src/server/__tests__/app.test.ts` after each extraction.
- Run `vp check` on the app workspace and `bun run check:boundaries`.
- Run `vp run -r test` after focused tests pass.
- Build through `vp run build` to verify Bun binary asset/worker behavior.
- Rerun focused Fallow complexity for changed files and the repository score; require the three original hotspots and all extracted helpers to stay below cyclomatic 20, cognitive 15, and CRAP 30, with no new dead files/exports.
- Manually launch the development stack with a representative Zarr dataset and smoke-test startup, REST/WebSocket routing, plugin bootstrap, and graph-node interactions (selection, form cycling, resize, staging, fullscreen, delete, and unresolved-node rendering).
