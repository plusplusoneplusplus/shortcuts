---
status: pending
---

# 004: Add keyboard shortcuts, match highlighting, and polish

## Summary
Add Ctrl+F/Cmd+F keyboard shortcut to focus the search input, Escape to clear and blur, bold matched substrings in search results, and archived item styling in `TaskSearchResults`.

## Motivation
This is polish that makes the search feature feel native: keyboard shortcuts match IDE conventions (Ctrl+F to find), highlighted matches let users instantly see why a result matched, and archived styling preserves visual consistency with the Miller column view. Separating these from the core wiring (commits 001–003) keeps each commit reviewable.

## Changes

### Files to Create
(none)

### Files to Modify

- `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` — Add `searchInputRef = useRef<HTMLInputElement>(null)`, pass it to the search `<input>`, and add a `useEffect` with a `document.addEventListener('keydown', ...)` listener for Ctrl+F/Cmd+F (focus input, `e.preventDefault()`) and Escape (clear `searchInput`/`searchQuery`, blur input). Clean up with `removeEventListener` on unmount.

- `packages/coc/src/server/spa/client/react/tasks/TaskSearchResults.tsx` — Add an exported `highlightMatch(text: string, query: string): ReactNode` helper. Apply it to both `baseName` and `relativePath` renders. Add `opacity-60 italic` class to archived result items via `cn()`.

- `packages/coc/test/spa/react/TasksPanel.test.tsx` — Add tests for keyboard shortcut registration, focus behavior, and Escape clearing.

### Files to Delete
(none)

## Implementation Notes

### Keyboard listener pattern (TasksPanel.tsx)
Follow the established codebase pattern from `WikiAsk.tsx` (lines 35–47) and `Router.tsx` (lines 203–216):

```tsx
const searchInputRef = useRef<HTMLInputElement>(null);

// Inside the toolbar, attach ref to the search <input>:
// <input ref={searchInputRef} ... />

useEffect(() => {
    const handler = (e: KeyboardEvent) => {
        // Ctrl+F / Cmd+F → focus search input
        if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            searchInputRef.current?.focus();
        }
        // Escape → clear search and blur
        if (e.key === 'Escape') {
            if (searchInput || searchQuery) {
                setSearchInput('');
                setSearchQuery('');
                searchInputRef.current?.blur();
            }
        }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}, [searchInput, searchQuery]);
```

Key decisions:
- Use `document.addEventListener` (not `window`) to match `Router.tsx` / `Dialog.tsx` / `AIActionsDropdown.tsx` patterns.
- Include `searchInput` and `searchQuery` in the dependency array so the Escape handler sees current values.
- `e.preventDefault()` on Ctrl+F to suppress the browser's native find dialog.
- Escape only acts when there is an active search (avoids stealing Escape from dialogs/context menus when search is empty).

### highlightMatch helper (TaskSearchResults.tsx)
A pure function returning `ReactNode`:

```tsx
import type { ReactNode } from 'react';

export function highlightMatch(text: string, query: string): ReactNode {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
        <>
            {text.slice(0, idx)}
            <strong className="text-[#0078d4] dark:text-[#3794ff]">
                {text.slice(idx, idx + query.length)}
            </strong>
            {text.slice(idx + query.length)}
        </>
    );
}
```

Key decisions:
- Case-insensitive match (consistent with `filterTaskItems` from commit 001).
- Use `<strong>` with VS Code blue accent color (`#0078d4` / `#3794ff`) rather than `<mark>` for better dark-mode appearance and to match the existing codebase color palette (used in badges, selection highlights, queue indicators).
- Only highlights the first occurrence per string — keeps it simple, avoids visual noise.
- Exported so tests can verify it directly.

### Archived item styling (TaskSearchResults.tsx)
Apply the same classes used in `TaskTreeItem.tsx` (line 164):

```tsx
<li className={cn(
    'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs transition-colors',
    'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
    item.isArchived && 'opacity-60 italic',
)}>
```

The `cn` utility is imported from `../shared` (same as `TaskTreeItem`). The `isArchived` property is available on both `TaskDocument` and `TaskDocumentGroup` types.

### Search input ref wiring (TasksPanel.tsx)
The search `<input>` added in commit 002 lives in the toolbar `div.repo-tasks-toolbar`. Attach `ref={searchInputRef}` to it. The ref is declared alongside the existing `scrollRef = useRef<HTMLDivElement>(null)` (line 77).

## Tests

All tests in `packages/coc/test/spa/react/TasksPanel.test.tsx` using Vitest + `@testing-library/react` (matching the existing test file pattern):

- **`highlightMatch` returns plain text when query is empty** — Verify `highlightMatch('hello', '')` returns `'hello'`.
- **`highlightMatch` wraps matched substring in `<strong>`** — Render result, assert `screen.getByText` finds the `<strong>` element with correct text.
- **`highlightMatch` is case-insensitive** — Verify `highlightMatch('TaskDesign', 'taskd')` highlights `TaskD`.
- **`highlightMatch` returns plain text when no match** — Verify `highlightMatch('hello', 'xyz')` returns `'hello'`.
- **Ctrl+F focuses the search input** — Render `TasksPanel`, fire `keydown` event `{ key: 'f', ctrlKey: true }` on `document`, assert search input has focus.
- **Cmd+F focuses the search input** — Same as above with `metaKey: true`.
- **Escape clears search input and blurs** — Type into search input, fire Escape, assert input value is empty and input is not focused.
- **Escape does nothing when search is empty** — Fire Escape with empty search, verify no state change / no error.
- **Archived items in search results render with `opacity-60 italic`** — Render `TaskSearchResults` with an archived item, assert the `<li>` has both `opacity-60` and `italic` classes.

## Acceptance Criteria
- [ ] Ctrl+F (or Cmd+F on macOS) focuses the search input from anywhere in the Tasks panel
- [ ] Browser native find dialog does NOT open when Ctrl+F is pressed in the Tasks panel
- [ ] Escape clears the search text, resets to Miller columns view, and blurs the input
- [ ] Escape is a no-op when search input is already empty (does not interfere with dialogs)
- [ ] Matched portions of baseName are rendered in bold blue (`#0078d4` / `#3794ff`)
- [ ] Matched portions of relativePath are similarly highlighted
- [ ] Archived items in search results display with `opacity-60 italic` (matching TaskTreeItem)
- [ ] All new and existing tests pass (`npm run test` from repo root)
- [ ] No regressions in Miller column navigation or context menus

## Dependencies
- Depends on: 002, 003

## Assumed Prior State
- Search input exists in TasksPanel toolbar with `searchInput`/`searchQuery` state and debounced updates (commit 002)
- `TaskSearchResults.tsx` renders a flat filtered list with `baseName` and `relativePath` display, responding to `onFileClick` (commit 003)
- `flattenTaskTree()` and `filterTaskItems()` utilities exist in `useTaskTree.ts` (commit 001)
- `scrollRef` is the only existing `useRef` in `TasksPanelInner` (line 77)
