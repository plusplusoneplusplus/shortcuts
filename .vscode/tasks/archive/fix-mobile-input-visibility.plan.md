# Fix: Mobile Queue Task — Message Input & Send Button Not Visible

## Problem

On mobile, when viewing a queue task detail, the message input textarea and Send button are hidden behind the fixed bottom navigation bar (`MobileTabBar`). The input exists in the DOM but is clipped/obscured.

Two compounding issues:

1. **`overflow-y-auto` breaks the flex column height constraint** for the Queue tab.  
   The inner wrapper in `RepoDetail.tsx` uses `overflow-y-auto` for all non-tasks tabs. For queue, this makes `h-full` inside `RepoQueueTab` resolve to the unconstrained scroll height instead of the viewport height — so the flex column layout can't anchor the input to the bottom.

2. **Fixed `MobileTabBar` (56px / `h-14`) overlaps the bottom of the content area.**  
   `MobileTabBar` uses `position: fixed`, removing it from document flow. Nothing offsets the content area, so the last ~56px (where the input lives) is hidden beneath the nav bar.

## Affected Files

| File | Location |
|------|----------|
| `RepoDetail.tsx` | `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` |

## Proposed Changes

### Change 1 — Fix overflow mode for queue tab (line ~471)

The queue tab needs `overflow-hidden` (not `overflow-y-auto`) so its internal `flex flex-col h-full` layout resolves correctly.

```diff
- <div className="h-full overflow-y-auto min-w-0">
+ <div className={cn("h-full min-w-0", activeSubTab === 'queue' ? "overflow-hidden" : "overflow-y-auto")}>
```

### Change 2 — Add bottom padding on mobile to clear fixed tab bar (line ~467)

Add `pb-14` (56px) to the sub-tab content container on mobile so content is never hidden behind `MobileTabBar`.  
Exclude the `tasks` tab since `TasksPanel` has its own layout wrapper.

```diff
- <div id="repo-sub-tab-content" className="flex-1 min-h-0 min-w-0 overflow-hidden">
+ <div id="repo-sub-tab-content" className={cn("flex-1 min-h-0 min-w-0 overflow-hidden", isMobile && activeSubTab !== 'tasks' && "pb-14")}>
```

> `isMobile` and `activeSubTab` are already in scope at this location.

## Out of Scope

- `RepoChatTab` may have a similar overlap issue but is a separate investigation.
- `MobileTabBar` refactor to in-flow layout is a larger change and not required for this fix.
- `ProcessesView.tsx` already accounts for mobile bar height via `h-[calc(100vh-48px-56px)]` and does not need changes.

## Verification

1. Open the dashboard on a mobile viewport (or DevTools responsive mode, width ≤ 640px).
2. Navigate to a repo → Queue tab → select a running/completed task.
3. Confirm the message textarea and Send button are fully visible above the bottom nav bar.
4. Confirm non-queue tabs (info, pipelines, schedules, etc.) still scroll normally.
5. Confirm the tasks tab is unaffected.
