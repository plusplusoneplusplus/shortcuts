# Mobile Bottom Nav — Contextual Repo Actions

## Problem
When the user navigates into a repo detail view on mobile, the bottom nav still shows the three global tabs (Repos, Processes, Wiki). These are redundant — the user is already in the repos context, and navigation back is handled by the `←` back button. The sub-tab strip (Info, Git, Pipelines, Tasks, Queue, Schedules, Chat) already handles in-repo navigation but is harder to reach at the top of the screen.

## Approach — Option A: Contextual Bottom Nav
When a repo is selected (`selectedRepo !== null`), replace the global bottom nav with repo-specific quick-action tabs:

| Slot | Icon | Label | Action |
|------|------|-------|--------|
| 1 | ← (ChevronLeft) | Back | Clear selected repo, return to list |
| 2 | ▶ (PlayCircle) | Queue | Switch repo sub-tab to `queue` |
| 3 | 💬 (ChatBubble) | Chat | Switch repo sub-tab to `chat` |

The back slot replaces the need to reach the top-left `←` button. Queue and Chat are the two highest-value repo actions on mobile.

## Affected Files
- `packages/coc/src/server/spa/client/react/layout/BottomNav.tsx`
  — Add `selectedRepo` and `repoSubTab` from context; render contextual items when repo is selected.
- `packages/coc/src/server/spa/client/react/repos/ReposView.tsx`
  — Height class already accounts for bottom nav; no change needed (nav is still present).

## Implementation Notes
- `BottomNav` already reads from `DashboardContext` — extend to read `selectedRepo` and dispatch `SET_REPO_SUB_TAB` / `SET_SELECTED_REPO`.
- "Back" action: dispatch `SET_SELECTED_REPO` with `null` and update hash to `#repos`.
- "Queue" / "Chat" actions: dispatch `SET_REPO_SUB_TAB` and update hash to `#repos/{id}/queue` etc.
- Active state: highlight the slot whose `tab` matches current `repoSubTab` (for Queue/Chat); Back is never highlighted.
- Transition: swap nav items with a CSS fade or instant swap — no animation required.

## Out of Scope
- Tablet / desktop layout (bottom nav is already hidden at ≥ 768 px).
- Moving the sub-tab strip to the bottom (Option C) — more invasive, deferred.
- Adding more than 3 slots to the contextual nav.

## Todos
1. Read current `BottomNav.tsx` implementation.
2. Extend `BottomNav` to detect `selectedRepo` and render contextual items.
3. Wire Back / Queue / Chat dispatch + hash update.
4. Update active-state highlighting for contextual items.
5. Smoke-test on mobile viewport in browser DevTools.
