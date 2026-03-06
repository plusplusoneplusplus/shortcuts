# Mobile Space Optimization — CoC SPA Dashboard

## Problem

On mobile, the repo detail page wastes significant vertical space. The header chrome (TopBar + MobileRepoHeader + RepoDetail header + tab strip + BottomNav) consumes **~256px** of a ~667px viewport (iPhone SE), leaving only ~411px for actual content. The screenshot shows the Tasks tab with 3 items occupying a tiny fraction of the screen, with most space empty.

## Root Causes

| # | Component | File | Waste |
|---|-----------|------|-------|
| 1 | MobileRepoHeader ("← Repositories") | `ReposView.tsx` L21–37 | 44px (`h-11`), redundant with BottomNav "Back" button |
| 2 | RepoDetail header stacks to 2 rows on mobile | `RepoDetail.tsx` ~L191–336 | ~76px: `flex-col` + `py-3` creates title row + buttons row |
| 3 | Tab strip padding | `RepoDetail.tsx` ~L340–395 | 32px tall; `px-4` container + `px-3 py-2` per tab |
| 4 | Tasks toolbar not adapted for mobile | `TasksPanel.tsx` ~L717–774 | Buttons overflow, no compact mode |
| 5 | TaskPreview `min-w-[48rem]` | `TasksPanel.tsx` ~L810 | Forces 768px+ horizontal scroll on mobile |

### Chrome Budget (current)
```
TopBar:              48px  (h-12, fixed)
MobileRepoHeader:   44px  (h-11, "← Repositories" bar)
RepoDetail header:  ~76px (flex-col with py-3, 2 rows)
Tab strip:           32px (py-2 tabs)
BottomNav:           56px  (h-14, fixed)
─────────────────────────
Total chrome:       ~256px
Content remaining:  ~411px (on 667px screen)
```

### Chrome Budget (target)
```
TopBar:              48px  (unchanged)
RepoDetail header:  ~44px (single row, compact)
Tab strip:           28px (reduced padding)
BottomNav:           56px  (unchanged)
─────────────────────────
Total chrome:       ~176px
Content remaining:  ~491px (+80px gained, ~19% more content area)
```

## Approach

Reduce mobile chrome by ~80px through 5 surgical changes, ordered by impact.

## Tasks

### 1. Remove MobileRepoHeader on mobile (saves 44px)
**File:** `packages/coc/src/server/spa/client/react/repos/ReposView.tsx`

The "← Repositories" back bar (`h-11`, 44px) is fully redundant — the BottomNav already has a "Back" button at the bottom. Remove or hide this component on mobile when the BottomNav is visible.

- Remove or conditionally hide `<MobileRepoHeader>` rendering
- Ensure BottomNav "Back" still navigates correctly (it already does)
- Update `heightClass` calc: change `h-[calc(100vh-48px-56px)]` since we no longer subtract the MobileRepoHeader

### 2. Compact RepoDetail header on mobile (saves ~32px)
**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

Currently the header uses `flex-col` on mobile, stacking repo name and buttons into 2 rows. Make it a single row:

- Change mobile layout from `flex-col` to `flex-row items-center` (keep `flex-col` only if the screen is truly too narrow)
- Reduce padding from `py-3` to `py-2` on mobile
- Make "New Chat" button more compact on mobile (icon-only or smaller text)
- Keep the "⋯" overflow menu as-is

### 3. Tighten tab strip on mobile (saves ~4px)
**File:** `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

- Reduce tab button padding from `px-3 py-2` to `px-2 py-1.5` on mobile
- Reduce container side padding from `px-4` to `px-2` on mobile
- The strip already scrolls horizontally, so smaller padding won't break layout

### 4. Adapt Tasks toolbar for mobile
**File:** `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx`

The toolbar shows "+ New Task", "+ New Folder", and search on a single row with no mobile adaptation:

- On mobile: collapse "+ New Folder" into the "⋯" overflow menu or a combined dropdown on the "+ New Task" button
- Make search input full-width on a second row only when focused, or collapse into a search icon
- Reduce toolbar `py-2` to `py-1.5` on mobile

### 5. Fix TaskPreview for mobile
**File:** `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx`

`TaskPreview` has `min-w-[48rem]` (768px) which forces a wide horizontal scroll on mobile:

- On mobile, hide `TaskPreview` by default and show it as a full-screen overlay or navigate into it
- Or set `min-w-0` on mobile and let it take full width when the task list is hidden

## Files to Modify

| File | Changes |
|------|---------|
| `packages/coc/src/server/spa/client/react/repos/ReposView.tsx` | Remove/hide MobileRepoHeader |
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Compact header + tighter tab strip |
| `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` | Responsive toolbar + fix TaskPreview width |

## Testing

- Verify on mobile viewport (375px width, Chrome DevTools) for each change
- Test iPhone SE (375×667), iPhone 14 (390×844), and Android small (360×640)
- Ensure BottomNav "Back" navigation still works after MobileRepoHeader removal
- Ensure tab strip still scrolls and all 7 tabs are reachable
- Ensure Tasks toolbar buttons remain functional
- Run `cd packages/coc && npm run test:run` to verify no regressions
