# Git Tab Left Sidebar Redesign + Refresh Button

## Problem

The current left sidebar (`RepoGitTab` → `BranchChanges` + `CommitList`) has no visual distinction between the different states a Git workspace can be in, and there is no way for the user to manually refresh the data once the tab is loaded. As the user's Git state changes in the background (new commits, pushes, branch switches), the panel becomes stale with no recovery path short of reloading the page.

## Current Structure (Left Panel)

```
[BranchChanges] — collapsible, shows branch-range diff against default branch
[CommitList: UNPUSHED (N)]
[CommitList: HISTORY (N)]
```

All data loads once on mount; no refresh mechanism exists.

---

## Scenarios to Design For

| # | Scenario | Signals | Current behaviour |
|---|---|---|---|
| 1 | **Clean main** | On default branch, 0 unpushed, 0 branch changes | Shows only HISTORY; BranchChanges section hidden |
| 2 | **Feature branch, clean** | On feature branch, 0 unpushed to remote, branch changes present | BranchChanges shown + HISTORY |
| 3 | **Feature branch, ahead** | Feature branch + unpushed commits | BranchChanges + UNPUSHED + HISTORY |
| 4 | **Behind remote** | Local branch behind upstream | Not reflected at all today |
| 5 | **Detached HEAD** | No branch name | Panel shows generic hash |

---

## Proposed UX Redesign — Left Sidebar

### 1. Panel Header Bar (new)
A fixed header strip at the top of the left panel containing:
- **Branch pill** — current branch name (from `/git/branch-status`)
- **Ahead/behind badge** — `↑N ↓M` counts when nonzero
- **Refresh icon button** — ↻ (clockwise arrow), right-aligned, triggers full re-fetch

The header stays visible while the list scrolls.

### 2. Scenario Banner (contextual, replaces current BranchChanges header design)
Below the header bar, show a scenario-specific status banner:

| Scenario | Banner |
|---|---|
| Clean main | *(hidden — no banner needed)* |
| Feature branch | `BRANCH CHANGES: <base>` — collapsible, existing behaviour kept |
| Ahead of remote | `↑N commits ahead of <remote>/<branch>` — subtle info row |
| Behind remote | `↓N commits behind — consider pulling` — warning-tinted row |
| Both ahead+behind | Combined row |

### 3. Section Structure
Keep existing UNPUSHED / HISTORY sections but:
- **Rename** "UNPUSHED" → "UNPUSHED (↑N)" with the count always visible in the title even when section is empty (shows "UNPUSHED (0)" with dimmed style)
- **Collapse by default** HISTORY when UNPUSHED section is non-empty, to draw attention to local work
- **Empty state copy** per section instead of the section disappearing (e.g. "Nothing unpushed — you're up to date")

### 4. Refresh Button Behaviour
- Clicking ↻ triggers full re-fetch: commits list + branch-status + branch-range
- While refreshing: ↻ icon spins; panel does NOT show the full-page spinner (keep current content visible)
- On success: data replaced in place; selected commit retained if hash still exists in new list
- On error: small error toast near the header (non-blocking)
- Keyboard shortcut: `R` when focus is inside the left panel

---

## Affected Files

| File | Change |
|---|---|
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Extract fetch into `refreshAll()` callback; pass it down; add panel header with refresh button; track `refreshing` state |
| `packages/coc/src/server/spa/client/react/repos/BranchChanges.tsx` | Accept `onRefresh` prop or `refreshKey` to allow parent-driven re-fetch; expose branch-status (ahead/behind) to parent |
| `packages/coc/src/server/spa/client/react/repos/CommitList.tsx` | Add `showEmptyState` prop; style UNPUSHED (0) as dimmed; default-collapse HISTORY when unpushed > 0 |
| `packages/coc/src/server/spa/client/react/repos/GitPanelHeader.tsx` *(new)* | New component: branch pill + ahead/behind badge + refresh button |
| `packages/coc/src/server/spa/client/react/repos/index.ts` | Export new component |

---

## Implementation Tasks

1. [x] **`GitPanelHeader` component** — Branch name, ahead/behind counts, spinning ↻ refresh button. Accepts `branch`, `ahead`, `behind`, `refreshing`, `onRefresh` props.

2. [x] **Lift branch-status fetch into `RepoGitTab`** — Currently `BranchChanges` fetches `/git/branch-status` internally. Move this fetch to the parent so the header can display ahead/behind counts, and pass results down to `BranchChanges`.

3. [x] **`refreshAll()` in `RepoGitTab`** — Combine commits re-fetch + branch-status re-fetch into a single callback. Use a `refreshing` boolean state (separate from initial `loading`) so the spinner only shows on first load, not on refresh.

4. [x] **Update `CommitList`** — Add `defaultCollapsed` prop. When `defaultCollapsed=true`, section renders collapsed but with a visible toggle. Show "Nothing to push" empty state when `commits` is empty and `showEmpty` is true.

5. [x] **Update `BranchChanges`** — Accept `branchStatus` as a prop (instead of fetching it). Remove internal `/git/branch-status` call. Parent controls the data.

6. [x] **Scenario banner logic in `RepoGitTab`** — After lifting branch-status, derive the scenario from `ahead`/`behind`/`isOnDefault` and render the appropriate banner below the header.

7. [x] **CSS/style** — Add spin animation for refresh icon; style ahead/behind badge; style the empty states.

8. [x] **Tests** — Add/update unit tests in `packages/coc/test/` for the new header component and updated `CommitList` empty-state + collapse behaviour.

---

## Out of Scope

- Auto-polling / WebSocket-based live refresh (can be a follow-up)
- Staged/unstaged working-tree changes display
- Merge conflict indicators
- Any changes to the right-side CommitDetail panel
