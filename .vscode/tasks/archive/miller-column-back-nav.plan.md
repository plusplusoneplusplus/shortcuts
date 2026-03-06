# Fix: Miller Column Back Navigation & macOS Two-Finger Scroll

## Problem

After a recent change that introduced `MAX_VISIBLE_COLUMNS = 2` in `TaskTree.tsx`, navigating into a deeper folder level hides earlier columns and shows a `‹ N` overflow indicator. However, this indicator is a **display-only `<div>`** with no click handler — users cannot navigate back to hidden columns. On macOS, two-finger horizontal pan on the scroll container in `TasksPanel.tsx` also does not scroll.

## Acceptance Criteria

- [ ] Clicking `‹ N` in the miller column navigates back by one level (pops the last column from the selection path).
- [ ] Clicking `‹ N` repeatedly continues navigating back until the root column is reached.
- [ ] The `‹ N` indicator is visually distinct as a clickable button (cursor pointer, hover state).
- [ ] Two-finger horizontal pan on macOS scrolls the miller column container left/right.
- [ ] Existing column navigation (clicking folders forward) is unaffected.
- [ ] No regression in existing miller column tests.

## Root Cause

| Issue | Location | Details |
|-------|----------|---------|
| `‹ N` not clickable | `TaskTree.tsx` ~line 246 | `visibleStartIndex > 0` renders a `<div>` with no `onClick` |
| No back nav callback | `TaskTree.tsx` props | No `onNavigateBack` prop defined or wired |
| macOS two-finger pan | `TasksPanel.tsx` scroll container | `overflow-x-auto` alone doesn't enable trackpad horizontal scroll on macOS in some browser configurations; may need `wheel` event passthrough or CSS `touch-action` |

## Subtasks

### 1. Make `‹ N` a clickable back button (`TaskTree.tsx`)

- Add an `onNavigateBack?: () => void` prop to `TaskTree`.
- Convert the overflow indicator `<div>` to a `<button>` with `onClick={() => onNavigateBack?.()}`.
- Add Tailwind classes: `cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#2a2a2a]` and accessible `aria-label="Go back"`.

### 2. Wire back navigation in `TasksPanel.tsx`

- Locate where `<TaskTree>` is rendered and where `selectedPath`/column state is managed.
- Implement `handleNavigateBack`: pop the last path segment from the current folder selection to collapse one miller column level.
- Pass `onNavigateBack={handleNavigateBack}` to `<TaskTree>`.
- Update URL hash state to match the new (shallower) path.

### 3. Fix macOS two-finger horizontal scroll

- On the miller columns scroll container (`ref={scrollRef}`, class `miller-columns`), add a `onWheel` handler that redirects vertical-axis wheel deltas to `scrollLeft` when the event has a dominant horizontal component (`deltaX`), or ensure `touch-action: pan-x` / `overflow-x: scroll` is set.
- Alternative simpler fix: change `overflow-x-auto` to `overflow-x-scroll` and add `style={{ WebkitOverflowScrolling: 'touch' }}` (legacy but helps Safari/macOS trackpad).

### 4. Tests

- Add/update unit test in the existing miller column test file to assert `onNavigateBack` is called when the indicator is clicked.
- Verify no existing E2E tests break (`miller-auto-scroll.spec.ts`).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/TaskTree.tsx` | Add `onNavigateBack` prop; convert indicator `<div>` to `<button>` |
| `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` | Implement `handleNavigateBack`; pass prop; fix scroll container |

## Notes

- The `MAX_VISIBLE_COLUMNS = 2` constant was the intentional design choice; we keep it but make the truncation navigable.
- Back navigation should pop **one column at a time** (matching the `‹ N` count semantics — clicking once goes back 1 level, not N levels).
- Ensure the indicator still shows the correct count after navigating back.
