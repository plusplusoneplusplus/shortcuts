---
status: done
---

# 003: Build RepoActivityTab

## Summary
Create the real `RepoActivityTab` component by combining the queue-style left rail with conditional right-pane rendering for chat tasks versus other queue tasks. This commit introduces the new container, but does not make it the visible repo tab yet.

## Motivation
After commits 001 and 002, the codebase has the Activity route primitive and reusable detail components, but no dedicated Activity screen. Building `RepoActivityTab` before changing visible navigation gives the team a place to test the unified experience in isolation and keeps the eventual cutover commit focused on wiring rather than first-time feature assembly.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/react/repos/ActivityListPane.tsx` - shared queue-style left rail extracted from the current `RepoQueueTab`, including running/queued/history sections, filters, drag/drop hooks, pause markers, selection, and mobile list mode.
- `packages/coc/src/server/spa/client/react/repos/ActivityChatDetail.tsx` - inline chat detail surface that consumes top-level chat queue tasks, loads the linked process, and renders `ChatStartPane` / `ChatConversationPane` as appropriate.
- `packages/coc/src/server/spa/client/react/repos/ActivityDetailPane.tsx` - right-side switcher that chooses between `ActivityChatDetail` for top-level chat tasks and `QueueTaskDetail` for everything else.
- `packages/coc/src/server/spa/client/react/repos/RepoActivityTab.tsx` - top-level split-panel Activity container that owns the Activity-specific layout and connects the shared list/detail pieces.
- `packages/coc/test/spa/react/repos/RepoActivityTab.test.tsx` - focused component tests for the new Activity tab before visible cutover.

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` - reuse `ActivityListPane` (or the extracted list helpers) so the current Queue tab keeps working while sharing code with the new Activity tab.
- `packages/coc/src/server/spa/client/react/repos/index.ts` - export `RepoActivityTab`.
- `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` - only if needed to support reuse from `ActivityDetailPane` (for example, optional props for container class names or mobile back handling); avoid changing existing behavior.

### Files to Delete
- None.

## Implementation Notes
- The left rail should follow the current queue mental model exactly: running, queued, history, filters, pause markers, drag/drop, and hidden follow-up chat tasks all behave the same as in `RepoQueueTab`.
- `selectTask()` in Activity is the key behavior change: selecting a top-level chat task must keep the user inside Activity and show inline chat detail, not dispatch `SET_SELECTED_CHAT_SESSION` or switch repo sub-tabs.
- `ActivityChatDetail` should treat top-level chat queue tasks as the session source of truth. It should derive the process ID from the queue task (`task.processId ?? 'queue_' + task.id`) and keep using the current queue/process/SSE APIs rather than introducing any new endpoint.
- Internal chat follow-up tasks (`type === 'chat'` with `payload.processId` / `payload.parentTaskId`) must remain hidden in the Activity list, just as they are hidden in the Queue tab today.
- Keep Activity unmounted from visible repo navigation in this commit. It is acceptable to expose it only through tests and the manual Activity route added in commit 001.
- Prefer extracting shared list helpers over duplicating the entire left pane from `RepoQueueTab`; the goal is to make commit 005 deletion of the old Queue shell straightforward.

## Tests
- Add isolated tests for `RepoActivityTab` covering: empty state, running/queued/history rendering, top-level chat task selection, non-chat task selection, hidden follow-up chat task filtering, and mobile back/list behavior.
- Keep existing `RepoQueueTab` tests green after the shared left-pane extraction.
- If `ActivityDetailPane` is non-trivial, add a small unit test that proves it switches to `ActivityChatDetail` only for top-level chat tasks and to `QueueTaskDetail` otherwise.

## Acceptance Criteria
- [x] `RepoActivityTab` exists and renders a queue-style left rail plus a conditional right pane.
- [x] Selecting a top-level chat task in Activity renders inline chat detail instead of routing to Chat.
- [x] Selecting a non-chat task in Activity still renders the existing queue task detail experience.
- [x] Follow-up child chat tasks remain hidden in the Activity left rail.
- [x] `RepoQueueTab` continues to work during this transitional commit.
- [x] The new Activity component is covered by focused component tests.

## Dependencies
- Depends on: 001, 002

## Assumed Prior State
Commits 001 and 002 have landed, so `activity` is already a valid hidden repo-tab primitive and the reusable chat / pending-task detail components are available for Activity to compose.
