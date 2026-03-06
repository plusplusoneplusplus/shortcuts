# Plan: Add Filter Dropdown for Task Type in Queue Tab

## Problem
The Queue tab's "Completed Tasks" list shows all task types interleaved (Follow, Run Pipeline, Chat, Code Review, etc.). With 45+ completed tasks, it's hard to find specific task types. Users need a filter dropdown to narrow the list by task type.

## Approach
Add a filter dropdown to the Queue tab's left panel that filters **all three sections** (Running, Queued, Completed) by task type. The filter uses the `type` field from `QueuedTask` which has well-defined values.

## Target File
`packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

## Design

### Filter Location
Place the dropdown **above the task list sections**, next to the existing "Queue" label and pause/resume button. When no tasks are active (only history), the toolbar should still show.

### Filter Options
Derived from `TaskType` enum + an "All" default:
- **All** (default — no filtering)
- **Follow Prompt** (`follow-prompt`)
- **Run Pipeline** (`run-pipeline`)
- **Chat** (`chat`)
- **Code Review** (`code-review`)
- **Custom** (`custom`)
- **Other** (catch-all for `resolve-comments`, `ai-clarification`, `task-generation`, etc.)

Only show filter options that have at least 1 matching task across all three lists (running + queued + history). This avoids empty filter options.

### Filter Behavior
- Client-side only — no API changes needed
- Applies `useMemo` to derive `filteredRunning`, `filteredQueued`, `filteredHistory` from the filter state
- Section counts update to reflect filtered counts (e.g., "Completed Tasks (12)" when filtered)
- Selected task persists even if filtered out (don't clear selection on filter change)
- Filter resets to "All" when switching workspaces

### UI Component
Use a native `<select>` element styled with Tailwind classes matching the existing design:
- Small text (text-xs), matching the `text-[#848484]` color scheme
- Placed in the toolbar row, right-aligned or between "Queue" label and pause button

## Todos

1. **add-filter-state** — Add `filterType` state and type-to-label mapping constant to `RepoQueueTab`
2. **compute-available-filters** — Add `useMemo` to compute which filter options have matching tasks and derive filtered lists
3. **render-filter-dropdown** — Render `<select>` dropdown in the toolbar area, always visible when tasks exist
4. **update-section-counts** — Update Running/Queued/Completed section counts to use filtered list lengths
5. **reset-on-workspace** — Reset filter to "All" when `workspaceId` changes
6. **add-tests** — Add tests for filter behavior in existing test files

## Files Changed
- `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` — Main implementation (filter state, UI, filtering logic)
- `packages/coc/test/spa/react/repo-queue-*.test.ts` — New test for filter behavior

## Notes
- No new shared components needed — native `<select>` is simplest and matches existing patterns (queue-job-dialog uses `<select>`)
- No API/server changes — purely client-side filtering
- The `type` field is always present on `QueuedTask` objects, so filtering is reliable
- "Other" bucket groups uncommon types to keep the dropdown concise
