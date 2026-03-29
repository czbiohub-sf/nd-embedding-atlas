# Phase 3: DataTable — Fix Broken Sorting + O(n) visibleData

Fix two bugs in the table component. Read each file before editing.

## BUG 1: Sorting is silently broken

Read `frontend/src/components/table/DataTable.tsx` fully.

The sorting state uses a ref (`sortingRef`) and a custom DOM event dispatch instead of
React state. The `sort` useMemo has empty deps `[]` so it NEVER recomputes after mount.
Clicking column headers dispatches a DOM event but nothing re-renders the table correctly.

### Fix:

Replace `sortingRef` + DOM event pattern with proper React state:

```tsx
// Replace:
const sortingRef = useRef<SortingState>([]);
// ... onSortingChange: (updater) => { sortingRef.current = ...; dispatchEvent(...) }
// ... const sort = useMemo(() => { ...uses sortingRef.current... }, [])  // NEVER updates

// With:
const [sorting, setSorting] = useState<SortingState>([]);
// ... onSortingChange: setSorting
// ... const sort = useMemo(() => { ...derive sort from sorting... }, [sorting])
```

Make sure `sort` is derived from the `sorting` state and passed to `useTableQuery` so
the query re-runs when sort changes.

## BUG 2: `visibleData` iterates ALL `totalCount` rows — O(n) for 400k+ datasets

Read `frontend/src/components/table/useTableQuery.ts` fully.

The `visibleData` useMemo in DataTable loops `for (let i = 0; i < totalCount; i++) getRow(i)`.
For 455k rows, this checks every index to find ~500 cached rows → causes multi-second freezes.

### Fix:

In `useTableQuery.ts`, add a `getCachedRows()` function to the hook return value:

```ts
getCachedRows: (): Row[] => {
  const rows: Row[] = [];
  for (const entry of pagesRef.current.values()) {
    for (const row of entry.rows) rows.push(row);
  }
  return rows;
}
```

In `DataTable.tsx`, replace the `visibleData` useMemo loop with:
```tsx
const visibleData = useMemo(() => getCachedRows(), [totalCount, getCachedRows]);
```

---

## Validation

```bash
cd frontend && pnpm exec tsc --noEmit
```

Fix ALL TypeScript errors. Verify sorting state is properly reactive.
