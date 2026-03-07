---
status: completed
---

# 004: Switch visible navigation to Activity

## Summary
Make Activity the only visible repo work tab by updating the repo sub-tab strip, mobile pinned tabs, badge presentation, and keyboard shortcut handling. Mount `RepoActivityTab` from `RepoDetail`, but keep the old Chat and Queue render branches hidden behind legacy state for one more commit so the final cleanup can delete them cleanly.

## Motivation
Commit 003 built the unified Activity experience, but users still reach Chat and Queue through the old navigation. This commit performs the actual cutover that the user sees: Activity replaces the two separate tabs in desktop and mobile navigation, and the old top-level Chat affordances are removed from the repo header.

## Changes

### Files to Create
- None.

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` - replace the visible `chat` / `queue` `SUB_TABS` entries with a single `{ key: 'activity', label: 'Activity' }`, mount `RepoActivityTab` for `activeSubTab === 'activity'`, remove the old top-bar New Chat trigger/dialog wiring, and move badge rendering to Activity.
- `packages/coc/src/server/spa/client/react/layout/MobileTabBar.tsx` - replace the default pinned Chat/Queue combination with Activity and update badge props/logic so the mobile bar shows Activity instead.
- `packages/coc/src/server/spa/client/react/layout/Router.tsx` - add or switch the repo keyboard shortcut to Activity (`A` is the cleanest choice), route visible repo navigation to `#repos/<workspaceId>/activity`, and make `tabFromHash()` treat Activity as the canonical repo work tab.
- `packages/coc/src/server/spa/client/react/repos/ReposView.tsx` or any surrounding repo-navigation wrapper - update any hard-coded visible labels or default sub-tab assumptions that still point to Queue/Chat.
- `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts` - adjust the exported shape only if needed by the new Activity badge UI; avoid backend/API changes.
- `packages/coc/test/spa/react/RepoDetail.test.ts` - add or update smoke assertions for the visible Activity tab and the removed Chat/Queue tab buttons.
- `packages/coc/test/spa/react/layout/MobileTabBar.test.tsx` - update the visible pinned-tab expectations to Activity.
- `packages/coc/test/spa/react/Router.test.ts` - add a visible-navigation smoke check for the Activity route / shortcut.

### Files to Delete
- `packages/coc/test/spa/react/repos/RepoDetail-floating-chat.test.ts` - source-text test for the floating `NewChatDialog` wiring that is intentionally removed in this cutover commit.

## Implementation Notes
- Keep the old `activeSubTab === 'chat'` and `activeSubTab === 'queue'` render branches in `RepoDetail` for this commit only. They are no longer reachable through visible nav, but leaving them in place makes the next cleanup commit a clean delete instead of mixing cutover and deletion.
- The desktop Activity badge should reuse the current queue-style mental model: a running badge and a queued badge are enough; do not preserve a separate chat-only badge in the visible nav.
- The mobile Activity badge can be a single numeric count if space is tight, even if the desktop header keeps running/queued badges split.
- Remove the header-level `NewChatDialog` entry point here so chat creation starts from Activity itself rather than from an orphaned floating dialog.
- Do not remove `parseChatDeepLink`, `parseQueueDeepLink`, `selectedChatSessionId`, or the legacy Chat/Queue render branches yet. Those deletions belong to the next commit.

## Tests
- Update `RepoDetail` tests so the visible repo tab strip exposes Activity and no longer exposes Chat/Queue buttons.
- Update `MobileTabBar` tests so Activity is pinned by default and receives the visible badge treatment.
- Add a router smoke test for the Activity keyboard shortcut / visible hash path if one does not already exist.
- Delete `packages/coc/test/spa/react/repos/RepoDetail-floating-chat.test.ts`, since its only purpose is to assert the `NewChatDialog` wiring removed in this commit.
- Keep the legacy Chat/Queue tests that still rely on the hidden render branches green for one more commit.

## Acceptance Criteria
- [x] Desktop repo navigation shows Activity instead of separate Chat and Queue tabs.
- [x] Mobile repo navigation shows Activity instead of separate Chat and Queue pins.
- [x] `RepoDetail` mounts `RepoActivityTab` for the visible work surface.
- [x] The top-bar New Chat dialog/button is gone from the repo header.
- [x] Activity has the expected visible badge treatment in desktop and mobile nav.
- [x] The Activity route / shortcut is the visible way to reach repo work from this point onward.
- [x] Legacy hidden Chat/Queue render branches still exist only as transitional scaffolding for commit 005.

## Dependencies
- Depends on: 003

## Assumed Prior State
Commit 003 has landed, so `RepoActivityTab` exists and the codebase already has the hidden Activity route primitive plus reusable chat/detail building blocks.
