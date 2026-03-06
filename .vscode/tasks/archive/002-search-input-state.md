---
status: done
---

# 002: Add search input and state to TasksPanel toolbar

## Summary

Add a debounced search input field to the `TasksPanelInner` toolbar row. This introduces `searchQuery` / `searchInput` state and the debounce mechanism but does **not** wire any filtering logic — the query is set but not yet consumed.

## Motivation

Separating the UI shell (input + state) from the filtering logic (commit 003) keeps each commit small and independently reviewable. It also lets us validate the visual design and interaction (debounce, clear button, focus ring) before adding the tree-filtering behaviour.

## Changes

### Files to Create

(none)

### Files to Modify

- `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` — add search state, debounce logic, and the search `<input>` element in the toolbar row.

### Files to Delete

(none)

## Implementation Notes

### 1. New state hooks (inside `TasksPanelInner`, after existing `useState` hooks ~line 76–77)

```tsx
const [searchQuery, setSearchQuery] = useState('');   // debounced value (will drive filtering in 003)
const [searchInput, setSearchInput] = useState('');    // live input value
const debounceRef = useRef<ReturnType<typeof setTimeout>>();
```

`useState` and `useRef` are already imported on line 6:
```ts
import { useCallback, useEffect, useRef, useState } from 'react';
```

### 2. Debounce callback (right after the new state hooks)

```tsx
const onSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
        setSearchQuery(value);
    }, 150);
}, []);
```

This mirrors the pattern in `ProcessFilters.tsx` (lines 16-22) but targets local state instead of a context dispatch, and uses a 150 ms debounce (slightly snappier than ProcessFilters' 200 ms since the task tree is lighter).

Add a cleanup effect:

```tsx
useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
}, []);
```

### 3. Clear handler

```tsx
const onSearchClear = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
}, []);
```

### 4. Search input JSX — toolbar row (lines 616-646)

Insert the search input **between** the `+ New Folder` button and the `<div className="flex-1 min-w-0">` wrapper of `<TaskActions>`. The current toolbar markup is:

```tsx
<div className="repo-tasks-toolbar flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
    <Button ...>+ New Task</Button>
    <Button ...>+ New Folder</Button>
    {/* ▼ INSERT SEARCH INPUT HERE ▼ */}
    <div className="flex-1 min-w-0">
        <TaskActions ... />
    </div>
</div>
```

New JSX to insert:

```tsx
<div className="relative flex items-center max-w-[14rem]">
    <span className="absolute left-2 text-[#999] dark:text-[#888] pointer-events-none text-sm" aria-hidden="true">
        🔍
    </span>
    <input
        type="text"
        placeholder="Search tasks…"
        value={searchInput}
        onChange={e => onSearchChange(e.target.value)}
        className="w-full pl-7 pr-7 py-1 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
        data-testid="task-search-input"
    />
    {searchInput && (
        <button
            type="button"
            onClick={onSearchClear}
            className="absolute right-1.5 text-[#999] hover:text-[#333] dark:hover:text-[#eee] text-sm leading-none"
            aria-label="Clear search"
            data-testid="task-search-clear"
        >
            ✕
        </button>
    )}
</div>
```

**Tailwind class rationale:**
- `border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]` — matches the exact classes used by `ProcessFilters.tsx` (line 54).
- `max-w-[14rem]` — keeps the search field from expanding too wide in the toolbar.
- `pl-7` — room for the 🔍 icon; `pr-7` — room for the ✕ clear button.
- `relative` wrapper + `absolute` positioned icon/button — standard pattern for adorned inputs.

### 5. No filtering yet

`searchQuery` is set by the debounce timer but **not passed** to `<TaskTree>` or used in any filter. That wiring happens in commit 003.

## Tests

- **Renders search input:** Mount `<TasksPanel>` and assert `[data-testid="task-search-input"]` exists with placeholder `"Search tasks…"`.
- **Debounce behaviour:** Type into the input, verify `searchInput` updates immediately (input value changes on each keystroke) while `searchQuery` only updates after the 150 ms debounce window (can be tested by advancing fake timers).
- **Clear button visibility:** Assert `[data-testid="task-search-clear"]` is absent when input is empty, present when input has text.
- **Clear button resets both states:** Click clear, assert input value is `""` and `searchQuery` is `""`.
- **Cleanup on unmount:** Unmount component, verify no lingering timeout fires (no act warnings / state-update-on-unmounted errors).

## Acceptance Criteria

- [ ] `TasksPanelInner` has `searchQuery` and `searchInput` state hooks
- [ ] Debounce ref is created and cleaned up on unmount
- [ ] `onSearchChange` callback debounces at 150 ms before setting `searchQuery`
- [ ] Search input renders in the toolbar between `+ New Folder` and `<TaskActions>`
- [ ] Input uses matching Tailwind classes from `ProcessFilters.tsx` (`border-[#e0e0e0]`, `dark:bg-[#3c3c3c]`, `focus:border-[#0078d4]`, etc.)
- [ ] 🔍 icon is visible to the left of the input text
- [ ] ✕ clear button appears only when `searchInput` is non-empty
- [ ] Clicking ✕ resets both `searchInput` and `searchQuery` to `''`
- [ ] `searchQuery` is **not yet consumed** — no filtering, no prop passing
- [ ] Existing toolbar buttons (`+ New Task`, `+ New Folder`) and `<TaskActions>` remain unchanged
- [ ] All existing tests still pass

## Dependencies

- Depends on: 001

## Assumed Prior State

`flattenTaskTree()` and `filterTaskItems()` are exported from `useTaskTree.ts` (from commit 001). They are not used in this commit but will be consumed in commit 003.
