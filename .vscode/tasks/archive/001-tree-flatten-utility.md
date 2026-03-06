---
status: pending
---

# 001: Add tree flattening utility and search filter

## Summary

Add two pure utility functions to `useTaskTree.ts` — `flattenTaskTree` to recursively collect all `TaskDocument` and `TaskDocumentGroup` items from a `TaskFolder` hierarchy, and `filterTaskItems` to perform case-insensitive substring filtering on those items. Both are fully unit-tested via Vitest.

## Motivation

These functions are the foundational building blocks for the Tasks Panel Search feature. Extracting them as a standalone, well-tested commit keeps the diff small, enables independent review, and provides a stable base for the UI wiring in subsequent commits. They have zero dependencies on React or any UI code.

## Changes

### Files to Create

- `packages/coc/test/spa/react/flattenTaskTree.test.ts` — Vitest tests covering `flattenTaskTree` and `filterTaskItems`. Follows the existing test pattern in `packages/coc/test/spa/react/useTaskTree.test.ts` (plain `describe`/`it`/`expect` with inline mock data, no React rendering needed).

### Files to Modify

- `packages/coc/src/server/spa/client/react/hooks/useTaskTree.ts` — Add two exported functions after the existing `countMarkdownFilesInFolder` helper (before the `// ── Hook ──` section):
  1. `flattenTaskTree(folder: TaskFolder): (TaskDocument | TaskDocumentGroup)[]`
  2. `filterTaskItems(items: (TaskDocument | TaskDocumentGroup)[], query: string): (TaskDocument | TaskDocumentGroup)[]`

### Files to Delete

(none)

## Implementation Notes

### `flattenTaskTree`

```ts
export function flattenTaskTree(folder: TaskFolder): (TaskDocument | TaskDocumentGroup)[] {
    const result: (TaskDocument | TaskDocumentGroup)[] = [];
    const contextDocs: TaskDocument[] = (folder as any).contextDocuments ?? [];

    // Collect leaf items from this folder
    result.push(...folder.singleDocuments);
    result.push(...folder.documentGroups);
    result.push(...contextDocs);

    // Recurse into child folders
    for (const child of folder.children) {
        result.push(...flattenTaskTree(child));
    }

    return result;
}
```

Key decisions:
- Uses the same `(folder as any).contextDocuments` pattern already established by `folderToNodes` (line 88 of `useTaskTree.ts`) since `contextDocuments` is optional and not declared on the SPA's `TaskFolder` interface (it exists on the `pipeline-core` canonical type but not the SPA re-declaration).
- Returns `TaskDocument | TaskDocumentGroup` union — consumers can use the existing `isTaskDocument` / `isTaskDocumentGroup` type guards to distinguish.
- Does **not** include `TaskFolder` nodes in the output — the purpose is a flat list of leaf items for search.
- Empty folders produce an empty array (no special-casing needed; the spreads handle it).

### `filterTaskItems`

```ts
export function filterTaskItems(
    items: (TaskDocument | TaskDocumentGroup)[],
    query: string,
): (TaskDocument | TaskDocumentGroup)[] {
    if (!query) return items.slice().sort((a, b) => a.baseName.localeCompare(b.baseName));

    const q = query.toLowerCase();

    return items
        .filter((item) => {
            // Both TaskDocument and TaskDocumentGroup have baseName
            const haystack: string[] = [item.baseName];

            if (isTaskDocument(item)) {
                haystack.push(item.fileName);
                if (item.relativePath) haystack.push(item.relativePath);
            }

            if (isTaskDocumentGroup(item)) {
                // Also match against individual document fileNames in the group
                for (const doc of item.documents) {
                    haystack.push(doc.fileName);
                    if (doc.relativePath) haystack.push(doc.relativePath);
                }
            }

            return haystack.some((field) => field.toLowerCase().includes(q));
        })
        .sort((a, b) => a.baseName.localeCompare(b.baseName));
}
```

Key decisions:
- Follows the `filterQueueTask` haystack pattern from `ProcessesSidebar.tsx` (lines 34–40): collect searchable fields into an array, lowercase, and check substring inclusion.
- Uses existing `isTaskDocument` and `isTaskDocumentGroup` type guards already exported from the same file.
- Empty query returns all items (sorted) — this allows the caller to use the same code path regardless of whether search is active.
- Always returns a new sorted array (never mutates the input).
- For `TaskDocumentGroup`, searches into the group's child document `fileName` and `relativePath` fields so that searching "plan" will match a group containing `task1.plan.md`.

### Import considerations

Both functions only use types and guards already defined in `useTaskTree.ts` — no new imports needed.

## Tests

Test file: `packages/coc/test/spa/react/flattenTaskTree.test.ts`

Imports from `../../../src/server/spa/client/react/hooks/useTaskTree` (same pattern as the existing `useTaskTree.test.ts`).

### `flattenTaskTree` tests

- **empty folder** — folder with no children, no singleDocuments, no documentGroups → returns `[]`
- **folder with singleDocuments only** — returns those documents
- **folder with documentGroups only** — returns those groups
- **folder with contextDocuments** — includes context documents from `(folder as any).contextDocuments`
- **folder with all item types** — returns singleDocuments + documentGroups + contextDocuments
- **nested folders** — parent with child folder; items from both levels appear in output
- **deeply nested structure (3+ levels)** — verifies full recursion
- **does not include TaskFolder nodes** — output contains only `TaskDocument` and `TaskDocumentGroup` items (verified via type guards)

### `filterTaskItems` tests

- **empty query returns all items sorted by baseName** — verifies sort order
- **exact baseName match** — returns matching item
- **partial baseName match** — substring match works
- **case-insensitive match** — "TASK" matches "task1"
- **matches against fileName** — searching "plan.md" matches a TaskDocument with `fileName: 'task1.plan.md'`
- **matches against relativePath** — searching "feature" matches item with `relativePath: 'feature/sub'`
- **matches TaskDocumentGroup via child document fileName** — searching "spec" matches group containing `task1.spec.md`
- **no match returns empty array** — searching "nonexistent" returns `[]`
- **special characters in query** — searching "task1.plan" works (no regex interpretation)
- **results are sorted alphabetically by baseName** — verifies output order

## Acceptance Criteria

- [ ] `flattenTaskTree` is exported from `useTaskTree.ts` and recursively collects all `TaskDocument` and `TaskDocumentGroup` items
- [ ] `filterTaskItems` is exported from `useTaskTree.ts` and performs case-insensitive substring filtering
- [ ] `filterTaskItems` returns results sorted alphabetically by `baseName`
- [ ] Empty query in `filterTaskItems` returns all items (sorted)
- [ ] All tests pass: `cd packages/coc && npx vitest run test/spa/react/flattenTaskTree.test.ts`
- [ ] Existing tests still pass: `cd packages/coc && npx vitest run test/spa/react/useTaskTree.test.ts`
- [ ] No new dependencies added
- [ ] No changes to existing function signatures or behavior

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit.
