# Queue Tab Mobile Responsiveness

## Problem

On mobile devices, the Queue tab (`RepoQueueTab`) uses a fixed side-by-side layout with the left task-list panel at 320px (`w-80 flex-shrink-0`) and the right detail panel at `flex-1`. On a ~375px mobile screen the left panel consumes nearly all viewport width, making the right detail panel (which contains conversation turns, metadata, and task output) unreadable — users see only a sliver.

**Screenshot evidence:** The left list panel occupies ~80% of the screen; the right panel shows truncated status badges and partial text.

## Approach

Follow the **same pattern** already used by `RepoChatTab`: use the `useBreakpoint()` hook + `ResponsiveSidebar` drawer to switch from a fixed side-by-side layout to a stacked list → detail flow on mobile.

### Key files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` | Main component — needs mobile layout |
| `packages/coc/src/server/spa/client/react/hooks/useBreakpoint.ts` | Existing hook (no changes needed) |
| `packages/coc/src/server/spa/client/react/shared/ResponsiveSidebar.tsx` | Existing drawer component (no changes needed) |
| `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` | Detail panel — may need a back button for mobile |

## Tasks

### 1. Add mobile state and breakpoint detection to RepoQueueTab

- Import `useBreakpoint` hook and `ResponsiveSidebar` component.
- Add `mobileSidebarOpen` state (default `false`).
- Call `const { isMobile } = useBreakpoint();` inside the component.

### 2. Switch layout based on breakpoint

**Desktop (current behavior, unchanged):**
- Side-by-side `flex` layout: `w-80` left panel + `flex-1` right panel.

**Mobile (`isMobile === true`):**
- Show **only the task list** as full-width by default.
- When a task is selected (`selectTask`), show the **detail panel full-width** and hide the list.
- Provide a **back button** at the top of the detail panel to return to the list.
- Wrap the task-list in the full viewport width (remove `w-80 flex-shrink-0`).

**Implementation pattern** (matching RepoChatTab):
```tsx
const { isMobile } = useBreakpoint();
const [mobileShowDetail, setMobileShowDetail] = useState(false);

// In selectTask handler, add:
if (isMobile) setMobileShowDetail(true);

// JSX — mobile branch:
if (isMobile) {
    return (
        <div className="flex flex-col h-full overflow-hidden">
            {mobileShowDetail && selectedTaskId ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="p-2 border-b ...">
                        <button onClick={() => setMobileShowDetail(false)}>← Back</button>
                    </div>
                    <QueueTaskDetail />
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                    {/* Same task list content, full width */}
                </div>
            )}
        </div>
    );
}
// Desktop: keep existing layout unchanged
```

### 3. Auto-show detail for running task on mobile

- When a new running task appears and `isMobile`, optionally auto-select it to show the detail view (matching the desktop auto-select behavior that already exists).
- When `selectedTaskId` becomes `null` (e.g., task deleted), set `mobileShowDetail(false)` to return to list.

### 4. Add back button to QueueTaskDetail on mobile

- Pass an optional `onBack` prop to `QueueTaskDetail`.
- When provided, render a back-arrow button in the detail header.
- `RepoQueueTab` passes `onBack={() => setMobileShowDetail(false)}` only on mobile.

### 5. Tablet layout (optional refinement)

- On tablet (768–1023px), reduce left panel width from `w-80` (320px) to `w-64` (256px) to give the detail panel more room.
- Use `isTablet` from `useBreakpoint()` to conditionally apply the narrower width class.

### 6. Add tests

- Add unit tests in `packages/coc/test/spa/` to verify:
  - Mobile breakpoint renders list-only view (no split panel).
  - Selecting a task on mobile shows the detail view with a back button.
  - Clicking back returns to the list.
  - Desktop breakpoint still renders the split-panel layout.
- Follow existing test patterns from `packages/coc/test/spa/` (Vitest + React Testing Library).

## Notes

- **No changes to `useBreakpoint` or `ResponsiveSidebar`** — both are reused as-is.
- The approach uses a simple show/hide toggle rather than `ResponsiveSidebar` drawer, because the queue detail isn't a sidebar — it's the primary content. A drawer overlay would feel wrong for full-screen task detail. However, if the drawer pattern is preferred for consistency, it can be swapped in.
- Context menu (right-click task actions) should still work on mobile via long-press (browser default behavior).
- Drag-and-drop reordering of queued tasks is not practical on mobile and can be disabled when `isMobile` is true.
