# Phase 5: Shared Types — PanelId Relocation + ViewState + RowIndex

Fix module coupling: `providers/` layer imports `PanelId` from `scatter-gpu/types.ts`
(upward dependency — lower-level layer depending on a feature module). Also add missing
shared types used in many places.

Read each file before editing.

## TASK 1: Create `frontend/src/lib/branded-types.ts`

```ts
/**
 * Branded nominal types for cross-cutting identifiers.
 * Shared by providers/, scatter-gpu/, and components/.
 */

/** Stable panel identifier — branded string to prevent accidental mixing. */
export type PanelId = string & { readonly __brand: "PanelId" };
export const panelId = (id: string): PanelId => id as PanelId;

/** DuckDB __row_index__ value — distinct from GPU buffer point indices. */
export type RowIndex = number & { readonly __brand: "RowIndex" };
export const rowIndex = (n: number): RowIndex => n as RowIndex;
```

## TASK 2: Update `frontend/src/scatter-gpu/types.ts`

Find the `PanelId` type definition and `panelId` function. Replace them with re-exports:

```ts
export type { PanelId } from "../lib/branded-types";
export { panelId } from "../lib/branded-types";
```

Keep ALL other types in the file unchanged.

## TASK 3: Update `frontend/src/providers/SelectionSyncStore.ts`

Find the import of `PanelId` from `../scatter-gpu/types`.
Change it to import from `../lib/branded-types` instead.

## TASK 4: Update `frontend/src/providers/ViewSyncStore.ts`

Same as Task 3 — find the PanelId import and update to `../lib/branded-types`.

## TASK 5: Add `ViewState` to `frontend/src/types.ts`

The `{ panX: number; panY: number; zoom: number }` shape is repeated 6+ times across
scatter-gpu/types.ts, useScatterInteraction.ts, ViewSyncStore.ts, etc.

Add to `types.ts`:
```ts
/** Pan/zoom state for a scatter view. */
export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}
```

Then find the inline occurrences of this shape in scatter-gpu files and replace with
the imported `ViewState` type. Update imports as needed.

---

## Validation

```bash
cd frontend && pnpm exec tsc --noEmit
```

Should produce ZERO errors — all changes are re-exports and type aliases.
No runtime behavior changes at all.
