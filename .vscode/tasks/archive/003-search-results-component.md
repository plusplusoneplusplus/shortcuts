---
status: done
---

# 003: Add TaskSearchResults component and wire filtering

## Summary

Create a `TaskSearchResults` component that renders filtered task items as a flat scrollable list, and wire it into `TasksPanel` so that when `searchQuery` is non-empty the Miller columns are replaced with search results.

## Motivation

Commits 001 and 002 added the utility functions and the search input UI, but nothing consumes the query yet. This commit closes the loop: it flattens the tree, filters it against the debounced query, and renders the matches in a dedicated component. Keeping this in its own commit isolates the new component and the conditional-render logic from the toolbar changes.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/tasks/TaskSearchResults.tsx` — New React component that renders a flat list of search-matched task items. Accepts filtered results, the raw query string, comment counts, workspace ID, and an `onFileClick` callback. Renders an empty-state message when no results match.

### Files to Modify

- `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` — Import `flattenTaskTree` and `filterTaskItems` from `useTaskTree`, import the new `TaskSearchResults` component, add two `useMemo` derivations (`allItems`, `searchResults`), and conditionally render `<TaskSearchResults>` in place of `<TaskTree>` when `searchQuery` is non-empty.

### Files to Delete

(none)

## Implementation Notes

### TaskSearchResults component structure

```tsx
// Props interface
interface TaskSearchResultsProps {
    results: (TaskDocument | TaskDocumentGroup)[];
    query: string;
    commentCounts: Record<string, number>;
    wsId: string;
    onFileClick: (path: string) => void;
}
```

**Empty state** — When `results.length === 0`, render:
```tsx
<div className="px-4 py-8 text-center text-xs text-[#848484]">
    No tasks match &lsquo;{query}&rsquo;
</div>
```

**Result rows** — Each item is an `<li>` that reuses the Tailwind classes from `TaskTreeItem` for visual consistency:
```tsx
<li
    className={cn(
        'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs transition-colors',
        'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
    )}
    onClick={() => onFileClick(itemPath)}
    title={itemPath}
    data-testid={`search-result-${displayName}`}
>
```

Each row contains, in order:
1. **Icon** — `📄` for `TaskDocumentGroup`, `📝` for `TaskDocument` (same logic as `TaskTreeItem` line 211).
2. **Status icon** — Reuse `getStatusIcon()` pattern from `TaskTreeItem` (lines 65-73). Inline a local copy or import if exported. Render only when status is truthy: `<span className="flex-shrink-0 text-[10px]" data-status={status}>{statusIcon}</span>`.
3. **Display name** — `<span className="truncate text-[#1e1e1e] dark:text-[#cccccc]">{displayName}</span>`. For `TaskDocument` use `item.baseName || item.fileName`; for `TaskDocumentGroup` use `item.baseName`.
4. **Breadcrumb path** — `<span className="truncate text-[10px] text-[#848484]">{item.relativePath}</span>`. Dimmed and small so it doesn't dominate.
5. **Comment count badge** — Conditionally rendered when count > 0: `<span className="flex-shrink-0 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full min-w-[16px] text-center">{count}</span>` (identical to `TaskTreeItem` line 252-254).

**Path computation** — For `TaskDocument`, the clickable path is `relativePath + '/' + fileName` (normalising backslashes, matching `getItemPath()` in `TaskTreeItem`). For `TaskDocumentGroup`, use the first document's path the same way. Import `isTaskDocument` and `isTaskDocumentGroup` type guards from `useTaskTree`.

**Scrolling** — Wrap the `<ul>` in `<div className="flex-1 overflow-y-auto">` so long result lists scroll vertically within the same flex container that the Miller columns use.

### TasksPanel wiring

1. **New imports** at the top of `TasksPanelInner`:
   ```tsx
   import { flattenTaskTree, filterTaskItems } from '../hooks/useTaskTree';
   import { TaskSearchResults } from './TaskSearchResults';
   ```
   (`flattenTaskTree` and `filterTaskItems` were added in commit 001.)

2. **Derived state** inside `TasksPanelInner`, after the existing `useTaskTree` call (line 74) and wherever `searchQuery` is defined (commit 002):
   ```tsx
   const allItems = useMemo(() => tree ? flattenTaskTree(tree) : [], [tree]);
   const searchResults = useMemo(() => filterTaskItems(allItems, searchQuery), [allItems, searchQuery]);
   ```
   Import `useMemo` — it is already imported on line 6 (`useCallback, useEffect, useRef, useState`), so add `useMemo` to that import.

3. **Conditional rendering** inside the `miller-columns` scroll container (lines 647-674). Replace the inner flex div's first child:
   ```tsx
   <div className="flex h-full min-h-0 min-w-full">
       <div className="flex-shrink-0 h-full min-h-0">
           {searchQuery ? (
               <TaskSearchResults
                   results={searchResults}
                   query={searchQuery}
                   commentCounts={commentCounts}
                   wsId={wsId}
                   onFileClick={(path) => {
                       const { setOpenFilePath } = useTaskPanel();  // already destructured at line 75
                       setOpenFilePath(path);
                   }}
               />
           ) : (
               <TaskTree
                   tree={tree}
                   commentCounts={commentCounts}
                   wsId={wsId}
                   initialFolderPath={initialParams.initialFolderPath}
                   initialFilePath={initialParams.initialFilePath}
                   onColumnsChange={handleColumnsChange}
                   onFolderContextMenu={handleFolderContextMenu}
                   onFolderEmptySpaceContextMenu={handleFolderEmptySpaceContextMenu}
                   onFileContextMenu={handleFileContextMenu}
                   onDrop={handleDragDrop}
               />
           )}
       </div>
       {openFilePath && (
           <div className="h-full min-h-0 flex-1 min-w-[48rem] border-r border-[#e0e0e0] dark:border-[#3c3c3c]">
               <TaskPreview wsId={wsId} filePath={openFilePath} initialViewMode={initialParams.initialViewMode} />
           </div>
       )}
   </div>
   ```
   **Important:** `setOpenFilePath` is already destructured from `useTaskPanel()` at line 75 — but currently only `openFilePath` is destructured. Add `setOpenFilePath` to that destructuring and pass it directly in the `onFileClick` callback (no nested hook call). The callback becomes:
   ```tsx
   onFileClick={(path) => setOpenFilePath(path)}
   ```

4. **Scroll container adjustment** — When search results are active the `overflow-x-auto overflow-y-hidden` on the miller-columns div is fine; the inner `TaskSearchResults` handles its own vertical scroll. No className changes needed on the outer container.

### Pattern reference: WikiComponentTree filtering

The `useMemo` filter pattern follows the same shape as `WikiComponentTree` (lines 84-93) where `filteredGroups` is derived from `groups` + `filter` string. Here we derive `searchResults` from `allItems` + `searchQuery`.

### Status icon helper

To avoid coupling to `TaskTreeItem` internals, define a local `getStatusIcon(status?: string): string` inside `TaskSearchResults.tsx` with the same switch body (done→✅, in-progress→🔄, pending→⏳, future→📋, default→''). Alternatively, if `getStatusIcon` is exported from `TaskTreeItem`, import it. Currently it is **not** exported (line 65 is a plain `function`), so a local copy is cleaner for this commit. A follow-up refactor could extract it to a shared utility.

## Tests

- **TaskSearchResults renders results correctly** — Mount with 2 `TaskDocument` items and verify 2 `<li>` elements are rendered with correct display names, icons, and breadcrumb paths.
- **TaskSearchResults shows empty state** — Mount with `results=[]` and `query="xyz"`, verify the "No tasks match 'xyz'" message appears.
- **TaskSearchResults calls onFileClick** — Click a result row and assert `onFileClick` was called with the correct relative path.
- **TaskSearchResults shows comment count badge** — Provide `commentCounts` with a matching key, verify the badge renders with the correct count.
- **TaskSearchResults shows status icon** — Provide a `TaskDocument` with `status: 'done'`, verify the ✅ icon renders.
- **TasksPanel toggles between TaskTree and TaskSearchResults** — When `searchQuery` is empty, `<TaskTree>` is rendered; when non-empty, `<TaskSearchResults>` is rendered instead.
- **TasksPanel wires onFileClick to setOpenFilePath** — Simulate clicking a search result and verify `openFilePath` updates in the TaskContext, causing `<TaskPreview>` to appear.

## Acceptance Criteria

- [ ] New `TaskSearchResults.tsx` component exists and exports `TaskSearchResults`
- [ ] When `searchQuery` is non-empty, the Miller columns (`<TaskTree>`) are hidden and `<TaskSearchResults>` is rendered in their place
- [ ] When `searchQuery` is cleared (empty string), `<TaskTree>` re-appears and `<TaskSearchResults>` is removed
- [ ] Each search result row shows: icon (📄/📝), status icon (if any), display name, dimmed relative path breadcrumb, comment count badge (if > 0)
- [ ] Clicking a search result row calls `setOpenFilePath(path)`, opening the `<TaskPreview>` pane
- [ ] Empty state shows "No tasks match '{query}'" when filter returns zero results
- [ ] Result list scrolls vertically when results exceed the container height
- [ ] No regressions in existing Miller column navigation when search is inactive
- [ ] `useMemo` is added to the React import in `TasksPanel.tsx`
- [ ] All new and existing tests pass

## Dependencies

- Depends on: 001, 002

## Assumed Prior State

- `flattenTaskTree(folder: TaskFolder): (TaskDocument | TaskDocumentGroup)[]` and `filterTaskItems(items, query): (TaskDocument | TaskDocumentGroup)[]` are exported from `useTaskTree.ts` (commit 001)
- `searchQuery` state (debounced string) is defined inside `TasksPanelInner` and available in scope (commit 002)
- `useTaskPanel()` returns `setOpenFilePath` (already exists in `TaskContext.tsx` line 88) — just needs to be added to the destructuring in `TasksPanel.tsx` line 75
