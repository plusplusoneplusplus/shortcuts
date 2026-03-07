---
status: done
---

# 002: Extract chat and task detail primitives

## Summary
Pull reusable right-pane pieces out of the existing Chat and Queue detail surfaces so the future Activity tab can compose them without copying large blocks of JSX. Extract the start/composer and conversation views from `RepoChatTab`, and extract the pending-task detail blocks from `QueueTaskDetail` into standalone components.

## Motivation
Both existing repo-tab experiences are currently monolithic: `RepoChatTab.tsx` embeds large inline `renderStartScreen` and `renderConversation` sections, while `QueueTaskDetail.tsx` keeps the pending-task panels inline. The Activity tab needs these pieces in a reusable form, but changing behavior and structure at the same time would be risky. This commit is a pure extraction pass that keeps the current repo Chat and Queue experiences working as-is, while avoiding throwaway work on `NewChatDialog.tsx`, which is scheduled for deletion later in the migration.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/react/chat/ChatStartPane.tsx` - extracted start/composer view for new chats, including slash-command UI, model picker, read-only toggle, image previews, and start action.
- `packages/coc/src/server/spa/client/react/chat/ChatConversationPane.tsx` - extracted active-conversation pane for chat turns, suggestions, follow-up composer, retry/copy controls, and streaming state.
- `packages/coc/src/server/spa/client/react/chat/chatConversationUtils.ts` - shared helpers such as `getConversationTurns()` and any chat-pane shaping logic currently duplicated inside `RepoChatTab`.
- `packages/coc/src/server/spa/client/react/queue/PendingTaskInfoPanel.tsx` - extracted pending-task metadata and action panel currently embedded in `QueueTaskDetail`.
- `packages/coc/src/server/spa/client/react/queue/PendingTaskPayload.tsx` - extracted payload renderer currently embedded in `QueueTaskDetail`, including async image fetching and type-specific payload sections.

### Files to Modify
- `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` - replace inline `renderStartScreen` / `renderConversation` sections with `ChatStartPane` and `ChatConversationPane`.
- `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` - import and use `PendingTaskInfoPanel` / `PendingTaskPayload` instead of inline implementations.
- `packages/coc/src/server/spa/client/react/chat/index.ts` and `packages/coc/src/server/spa/client/react/queue/index.ts` (or existing barrels) - re-export the extracted pieces if the codebase already uses barrel imports in these areas.

### Files to Delete
- None.

## Implementation Notes
- Keep state ownership where it already lives. `RepoChatTab` and `QueueTaskDetail` should continue to own their hooks, refs, fetches, and event handlers; the new components should be prop-driven.
- Preserve existing `data-testid` values and keyboard behavior so current tests do not need wholesale rewrites in this commit.
- `ChatConversationPane` should be rich enough for future Activity use, including back-button slot/prop support for mobile layouts.
- `PendingTaskPayload` should keep the current type-specific branches (`follow-prompt`, `resolve-comments`, `chat`, `ai-clarification`, `task-generation`, `code-review`, `custom`) rather than collapsing them into a generic JSON dump.
- Be explicit about any props that represent existing hooks such as `useSlashCommands()` or `useImagePaste()`, so later commits can pass the same hook objects through without re-lifting state.
- Do not spend time refactoring `chat/NewChatDialog.tsx` in this commit. That dialog is removed later in the migration, so only `RepoChatTab` and the Activity path should consume the newly extracted chat panes.
- This commit must not introduce Activity-specific routing or selection logic yet; it only makes the current detail UIs reusable.

## Tests
- Keep all existing `RepoChatTab*` tests green without changing their intent.
- Keep existing `QueueTaskDetail` and queue-related tests green after the extraction.
- Add a focused unit test file for `chatConversationUtils.ts` covering the current `getConversationTurns()` branches.
- Add lightweight render tests for the extracted pending-task components if the existing suite does not already cover their top-level `data-testid` / action affordances.

## Acceptance Criteria
- [x] `RepoChatTab` renders the same chat UI as before this commit.
- [x] `QueueTaskDetail` still renders pending-task metadata, payload sections, and actions exactly as before this commit.
- [x] The extracted chat panes are reusable imports rather than inline JSX helpers.
- [x] The extracted pending-task components are reusable imports rather than inline helpers inside `QueueTaskDetail`.
- [x] Existing repo Chat/Queue detail tests remain green, with only additive utility tests introduced here.
- [x] No Activity tab is mounted or visible yet.

## Dependencies
- Depends on: 001

## Assumed Prior State
Commit 001 has landed, so `activity` already exists as a hidden repo-tab primitive and manual Activity hashes resolve to the queue fallback, but the visible Chat and Queue tabs are otherwise unchanged.
