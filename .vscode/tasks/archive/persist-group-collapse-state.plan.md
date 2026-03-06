# Persist Git Group Collapse State Across Sidebar Toggle

## Problem

When a git group (e.g. "plusplusoneplusplus/shortcuts") is collapsed in the Repos view and the user clicks the "minimize sidebar" button and then re-expands it, the group resets to expanded. This is because the group's collapsed/expanded state is stored only in React component state (`expandedState` in `ReposGrid.tsx`), which resets when the sidebar unmounts/remounts.

## Proposed Approach

Persist each git group's expanded/collapsed state to `localStorage` (client-only, keyed by normalized remote URL) so that it survives sidebar collapse/expand cycles and page refreshes.

Optionally also sync to server preferences (same pattern as `reposSidebarCollapsed`), but localStorage alone is sufficient for the stated bug.

## Acceptance Criteria

- [ ] Collapsing a git group and then toggling the sidebar keeps the group collapsed when the sidebar reopens.
- [ ] Collapsing a git group and refreshing the page keeps the group collapsed.
- [ ] Expanding a collapsed group and toggling the sidebar keeps the group expanded.
- [ ] Initial state (no persisted data) defaults to expanded for all groups (current behavior).
- [ ] State is keyed per group (one group's state does not affect another).

## Subtasks

1. **Define localStorage key** — use a prefix like `coc-git-group-expanded-<normalizedUrl>` or store all group states as a single JSON object under `coc-git-group-expanded-state`.
2. **Load persisted state on mount** — in `ReposGrid.tsx`, initialize `expandedState` from localStorage instead of `{}`.
3. **Persist on toggle** — in `toggleGroup()`, write the updated state to localStorage after each toggle.
4. **Write/update tests** — add or update tests for `ReposGrid` or the grouping logic to cover persistence behavior.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/ReposGrid.tsx` | Read initial state from localStorage; write to localStorage on toggle |

## Notes

- Key file: `packages/coc/src/server/spa/client/react/repos/ReposGrid.tsx`
  - `expandedState`: `Record<string, boolean>` — currently pure component state
  - `toggleGroup(url)`: flips `expandedState[url]`
  - `groupReposByRemote(repos, expandedState)` — produces `group.expanded` boolean
- The sidebar collapsed flag (`reposSidebarCollapsed`) is already persisted to localStorage + server preferences via `AppContext.tsx`; this fix only needs localStorage for the group state.
- Do NOT persist to server preferences unless the user requests cross-device sync — localStorage is simpler and sufficient.
- Default value for a group key that doesn't exist in storage should be `true` (expanded), matching current behavior.
