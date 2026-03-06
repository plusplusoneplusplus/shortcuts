# Add Git to Mobile Bottom Bar

## Problem
On mobile, only **Queue** and **Chat** (plus Tasks) appear in the bottom navigation bar. The **Git** tab is buried in the "···" More sheet, making it harder to access quickly.

## Acceptance Criteria
- [ ] `git` is included in the default pinned tabs of `MobileTabBar`
- [ ] The Git tab displays a badge count for pending/uncommitted changes (if applicable)
- [ ] All existing pinned tabs (tasks, queue, chat) continue to work correctly
- [ ] The "···" More button still appears for any remaining unpinned tabs
- [ ] Existing tests pass; new/updated tests cover the added git tab

## Location
**File:** `packages/coc/src/server/spa/client/react/layout/MobileTabBar.tsx`

**Current default:**
```typescript
const DEFAULT_PINNED: RepoSubTab[] = ['tasks', 'queue', 'chat'];
```

**Target:**
```typescript
const DEFAULT_PINNED: RepoSubTab[] = ['tasks', 'queue', 'chat', 'git'];
```

## Subtasks

### 1. Update `DEFAULT_PINNED` constant
- In `MobileTabBar.tsx`, add `'git'` to `DEFAULT_PINNED`.

### 2. Add git badge support (optional / investigate)
- Check if there is a git-pending-count prop available or if the `RepoSubTab` type already supports a badge for `git`.
- If a meaningful badge value exists (e.g. uncommitted file count, pending operations), add a `gitPendingCount` prop and wire it into `getBadgeCount`.
- If no meaningful badge exists, skip — badge just won't show for git.

### 3. Update `MobileTabBarProps` (if badge added)
- Add optional `gitPendingCount?: number` to the props interface.
- Default to `0`.

### 4. Update tests
- File: `packages/coc/src/server/spa/client/react/layout/__tests__/MobileTabBar.test.tsx` (or similar)
- Ensure git tab renders in bottom bar by default.
- Ensure badge renders when `gitPendingCount > 0` (if prop is added).

## Notes
- The `MobileTabBar` already accepts a `pinnedTabs` prop override, so this change only affects the default — callers can still override.
- With 4 pinned tabs + "···" the bar will have 5 items total; verify it still looks good on narrow screens (320px wide).
- `RepoSubTab` type lives in `packages/coc/src/server/spa/client/react/types/dashboard.ts` — confirm `'git'` is a valid value before changing the default.
