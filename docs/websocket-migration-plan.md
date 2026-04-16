# WebSocket migration plan

Context for a fresh Claude session. Written 2026-04-16 at commit `c16117e`
on branch `bun-binary`.

## Context summary (where we are)

- Single package.json, single `node_modules`, single `vite.config.ts`,
  single `tsconfig.json`. `src/frontend/`, `src/server/`, `src/zarr/`,
  `src/cli/`, `src/protocol/` all siblings under `src/`.
- Wire contracts (Zod schemas + response types + `NdeaProtocol` method map)
  live in `src/protocol/index.ts`. Both sides import from there.
- Server is Bun.serve. WebSocket upgrade is stubbed in `src/server/app.ts`
  (around line 115) — it accepts upgrades and has empty `websocket: { message,
open, close }` handlers. No dispatch yet.
- Frontend uses HTTP `fetch` for every endpoint. Mosaic uses `restConnector`
  in `src/frontend/dashboard/DashboardProvider.tsx`.
- Three polling loops exist (with unmount-cleanup fixes already applied):
  - `src/frontend/scatter-gpu/hooks/useEmbeddingLoader.ts` — polls
    `/api/embeddings/{key}/status` every 200 ms.
  - `src/frontend/scatter-gpu/hooks/useVarColumn.ts` — polls
    `/api/gene-column/{task_id}/status` every 800 ms.
  - `src/frontend/components/toolbar/ExportDialog.tsx` — polls
    `/api/export/{task_id}/status` every 1 s.

The WS protocol scaffolding (ProtocolMap, frame encode/decode, request
tracker) was **previously written and then deleted** as dead code in commit
`31070bb`. The file layout it lived under was `src/axial/net/{client,
server,protocol}.ts`. We can resurrect concepts but the files are gone —
rewriting from scratch is easier than `git revert` because the surrounding
code has drifted.

## Goals

1. **Eliminate the three polling loops.** Server pushes status transitions
   (loading → ready / error) instead of the client re-asking. Primary win.
2. **Single persistent connection** per browser tab for selection bursts
   (~20 fps lasso readback). Removes per-request TCP/TLS overhead.
3. **Typed method dispatch** using the existing `NdeaProtocol` method map.
4. **Graceful fallback.** If the WS fails (dev proxy, flaky network),
   everything must still work over HTTP — the WS layer is an optimization,
   not a new protocol we lock into.

## Non-goals (for this iteration)

- Replacing Mosaic's `/data/query` endpoint. Mosaic has a `socketConnector`
  and it'd be clean to migrate, but the win is small (DuckDB query time
  dominates the bursts) and Mosaic's reconnect semantics are finicky.
  Defer.
- Binary scatter endpoints (`/api/scatter-positions`, `-categories`,
  `-continuous-colors`). They're one-shot cached responses; HTTP is fine.
- Collaborative cursors / multi-client pub-sub. One client ↔ one server
  connection for now.

## Protocol design

Text + binary frames, multiplexed via request IDs.

### Text frame (JSON)

```json
{ "_id": 42, "_type": "gene-column/load", "_ch": "data", "gene": "MALAT1" }
```

- `_id: number` — monotonic from the client. Server echoes it on all
  replies + push messages for the same request.
- `_type: string` — method key from `NdeaProtocol` (e.g. `"gene-column/load"`,
  `"gene-column/status"`, `"embeddings/load"`).
- `_ch: "data" | "end" | "error"` — for streaming/push responses.
  - Single-shot reply: omit `_ch` (implicit `"end"`).
  - Streaming: multiple `"data"` frames then one `"end"`.
  - Server-initiated push (e.g. task status transition): `_ch: "data"` tied
    to the original `_id`, never a `"end"` until the task terminates.
- Remaining fields are the request/response payload.

### Binary frame

```
[ 4 bytes: uint32 LE request id ][ payload bytes ]
```

Used for Arrow IPC responses and the scatter binary blobs if we migrate
those later. For this iteration, binary frames are unused — all three
target endpoints are text-only.

### Type safety

Reuse `src/protocol/index.ts:NdeaProtocol`:

```ts
export interface NdeaProtocol extends ProtocolMap {
  "gene-column/load": {
    req: { gene: string; layer: string };
    res: { task_id: string; status: string; column: string };
  };
  "gene-column/status": {
    req: { task_id: string };
    res: { status: string; column?: string; error?: string };
  };
  // ...
}
```

Client + server share `NdeaProtocol` via `import type`. The client has
a typed `call<M>(method: M, req: ReqOf<M>): Promise<ResOf<M>>` (or
`.subscribe<M>(method, req, onMessage)` for push streams).

## Server implementation

### Files to add / change

1. **`src/server/ws.ts`** (new, ~200 LOC) — the dispatch layer.
   - `handleWsMessage(ws, data, state)` — parses text frames, routes by
     `_type` to a handler, sends back typed responses using the same `_id`.
   - `handleWsBinary(ws, data, state)` — reserved; throws "not implemented"
     for now.
   - Handler table keyed by method name:
     ```ts
     const HANDLERS: { [M in keyof NdeaProtocol]?: WsHandler<M> } = {
       "gene-column/load": handleGeneColumnLoadWs,
       "gene-column/status": handleGeneColumnStatusWs,
       "embeddings/load": handleEmbeddingsLoadWs,
       "embeddings/status": handleEmbeddingsStatusWs,
       "export/start": handleExportStartWs,
       "export/status": handleExportStatusWs,
     };
     ```
   - For the three status endpoints: accept a `subscribe: true` flag in the
     request. If present, server keeps the subscription on its side and
     pushes status transitions (no polling).

2. **`src/server/app.ts`** — wire the existing `websocket: { message,
open, close }` stub to `handleWsMessage`. Pass `state` + `store` through.

3. **`src/server/routes/var.ts`** — existing `handleGeneColumn` logic
   triggers materialization and returns `task_id`. Extract the
   materialization-complete hook so both the HTTP poll and the WS push
   can drain it:

   ```ts
   // Existing:
   void materialiseGeneColumn(...)
       .then(() => { task.status = "ready"; })
       .catch((err) => { task.status = "error"; task.error = ...; });
   // Add: subscriber callback list on the task, fired alongside status set.
   ```

4. **`src/server/routes/embeddings.ts`** + **`src/server/routes/export.ts`** —
   same pattern. The underlying task structures already exist; add a
   per-task subscriber list.

### Subscription bookkeeping

Each `ws` is a Bun.serve `ServerWebSocket`. Track subscriptions per
socket:

```ts
type Subscription = { id: number; type: keyof NdeaProtocol; taskId?: string };
const subs = new WeakMap<ServerWebSocket, Set<Subscription>>();
```

On `close(ws)`, drop all subscriptions for that socket. On task completion
(ready / error), iterate subscribers and send `{ _id, _ch: "data", ...status }`
followed by `{ _id, _ch: "end" }`. Drop the subscription from both sides.

### Fallback

Every WS method corresponds 1:1 to an existing HTTP route. The HTTP routes
stay. If the client can't open a WS (e.g. during Vite dev server reload,
network hiccup), it falls back to HTTP polling.

## Client implementation

### Files to add

1. **`src/frontend/lib/ws-client.ts`** (new, ~200 LOC)
   - `class NdeaWsClient` with:
     - Connection management: exponential backoff reconnect with jitter,
       cap at 5 s. Connection state exposed as a TanStack Store singleton.
     - `call<M extends keyof NdeaProtocol>(method: M, req: ReqOf<M>): Promise<ResOf<M>>`
       — single-shot request/response, keyed by auto-incrementing `_id`.
     - `subscribe<M>(method, req, onData): { unsubscribe: () => void }` —
       long-lived; fires `onData` on each push; resolves on `_ch: "end"`.
     - Outstanding request map: `Map<number, { resolve, reject }>`.
     - `send` queue buffers while disconnected; flushed on `open`.
   - Global singleton exported as `wsClient`.

2. **`src/frontend/stores/WsConnectionStore.ts`** (new, ~30 LOC)
   - TanStack Store with `{ connected: boolean; latencyMs: number | null;
lastError: string | null }`. Status bar reads from this.

### Files to change

1. **`src/frontend/scatter-gpu/hooks/useEmbeddingLoader.ts`** — replace
   the `pollUntilReady(key, signal)` fetch loop with:

   ```ts
   const sub = wsClient.subscribe("embeddings/status", { key }, (msg) => {
     if (msg.status === "ready") resolve();
     else if (msg.status === "error") reject(new Error(msg.error));
   });
   signal.addEventListener("abort", () => sub.unsubscribe());
   ```

   Fallback: if `wsClient.state.connected === false`, call existing
   `pollUntilReady` instead.

2. **`src/frontend/scatter-gpu/hooks/useVarColumn.ts`** — same pattern.
   Subscribe to `gene-column/status`, unsubscribe on unmount (already has
   the ref + cleanup from the earlier leak fix).

3. **`src/frontend/components/toolbar/ExportDialog.tsx`** — same pattern.
   Replace the setInterval-based poll with a subscription.

4. Add a small WS connection indicator to the status bar (optional).

### Mosaic stays on HTTP

`src/frontend/dashboard/DashboardProvider.tsx` keeps `restConnector`.
Consider migration later when we have a concrete latency complaint.

## Phased rollout

Keep HTTP endpoints live throughout. Migration is additive.

**Phase 1** — server-side WS dispatch (no frontend changes).

- Write `src/server/ws.ts` with handlers for the 6 methods.
- Hook into `Bun.serve` `websocket` handler in `app.ts`.
- Test by hand: `wscat -c ws://localhost:5055/` then send
  `{"_id":1,"_type":"embeddings/status","key":"X_phate"}`.
- Commit when server passes handcrafted probes.

**Phase 2** — client library.

- Write `src/frontend/lib/ws-client.ts` + `WsConnectionStore.ts`.
- Hook connect on DashboardProvider mount; auto-reconnect; expose
  `wsClient.state.connected` flag.
- No call sites yet — just the plumbing.
- Verify: open devtools Network → WS tab; see one upgrade, stable.

**Phase 3** — migrate `gene-column/status` (simplest: one frontend hook,
one server handler, well-isolated).

- Change `useVarColumn.ts` to use `wsClient.subscribe`.
- Fall back to HTTP on `!wsClient.state.connected`.
- Test: materialise a gene, verify no more `/status` polling in network
  tab; verify the loading→ready transition fires the subscribe callback.
- Commit.

**Phase 4** — migrate `embeddings/status` and `export/status`.

- Same pattern; smaller diff each since the client pattern is set.
- Commit each separately or batch.

**Phase 5** — performance pass (optional).

- Selection writes (`POST /api/scatter-selection` at ~20 fps during lasso)
  could go over WS. Worth it iff we measure HTTP overhead as user-visible.
- Mosaic `/data/query` migration — defer unless measured.

## Testing

- **Unit**: `NdeaWsClient` with a mock WebSocket (Bun's `bun:test` +
  `ws` mock). Verify outstanding-request routing, reconnect, send-queue
  replay.
- **Integration**: start backend, open WS via `bun:test` using Bun's
  native `WebSocket` client. Subscribe to `embeddings/status` for an
  embedding that is already loaded; assert one `ready` push then `end`.
- **Smoke**: after each phase, run the dev stack + compiled binary
  against the infectomics dataset, exercise the migrated endpoint in the
  browser, verify the fallback path by killing the backend mid-session.

## Risks

1. **Vite dev-server proxy & WS**. Vite's dev server proxies `/api` to
   `:5055`. WS upgrades need `ws: true` in the proxy config. Check
   `vite.config.ts` server.proxy — add `ws: true` for the bare path if not
   already present. Compiled binary serves frontend itself so this only
   matters in dev.
2. **Reconnect storms**. Exponential backoff + jitter mandatory. If 50
   clients lose connection simultaneously (server restart), we don't want
   them all reconnecting in the same 10 ms window.
3. **Abandoned subscriptions**. Every subscribe MUST unsubscribe on
   unmount. React StrictMode double-mount in dev is the common failure
   mode — test explicitly.
4. **Frame ordering**. WebSocket preserves order per connection; safe.
   But if we add a worker that also opens its own WS, their streams are
   independent.
5. **Compiled binary cold-connect**. In `./dist/ndea`, the frontend's WS
   URL derives from `window.location`. Verify dev and compiled both work.

## Open questions for the next session

- Do we want `wsClient` to auto-upgrade all HTTP calls, or keep per-call
  explicit choice? My lean: explicit per-call until we prove the WS path
  is rock-solid.
- Should reconnect re-subscribe or re-invoke pending `call`s? My lean:
  re-subscribe yes (subs are inherently long-lived), re-invoke no (a
  pending single-shot that didn't get a response should reject with
  `WsReconnectError` so the caller decides).
- Buffer size limit for the send queue when disconnected? Dropped-frame
  policy — head, tail, or error the pending call?

## Starting point for the next session

```bash
git log -1 --oneline       # should be c16117e (lint clean) or later
cat docs/websocket-migration-plan.md   # this file
grep -n "websocket" src/server/app.ts  # stub to replace
```

Start with **Phase 1**. Create `src/server/ws.ts`, wire into `app.ts`,
hand-probe with `wscat` or `Bun.connect`. First handler to implement:
`embeddings/status` (smallest state to subscribe to).
