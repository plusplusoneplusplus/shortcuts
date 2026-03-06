# Unify Chat Task Types

## Problem

The coc server has three task types for chat: `chat`, `readonly-chat`, and `chat-followup`. This creates combinatorial complexity and a scheduling bug — follow-ups on `readonly-chat` sessions are incorrectly scheduled as exclusive (serialized) because `chat-followup` is not in `SHARED_TASK_TYPES`.

## Approach

Collapse all three into a single `chat` type with two optional payload flags:
- `readonly?: boolean` — replaces the `readonly-chat` type
- `processId?: string` — replaces the `chat-followup` type (presence = follow-up)

Supporting follow-up fields (`parentTaskId`, `attachments`, `imageTempDir`) move into `ChatPayload` as optional.

## Tasks

### 1. Update type system (`coc-server`)

**File:** `packages/coc-server/src/task-types.ts`

- Remove `'readonly-chat'` and `'chat-followup'` from the `TaskType` union
- Delete `ChatFollowUpPayload` interface (L127–141)
- Remove `ChatFollowUpPayload` from the `TaskPayload` union (L152)
- Delete `isChatFollowUpPayload` type guard (L202–204)
- Delete `isReadOnlyChatPayload` type guard (L182–184)
- Extend `ChatPayload` with optional fields:
  ```typescript
  interface ChatPayload {
      readonly kind: 'chat';
      prompt: string;
      readonly?: boolean;
      processId?: string;
      parentTaskId?: string;
      attachments?: Attachment[];
      imageTempDir?: string;
      skillNames?: string[];
      workspaceId?: string;
      folderPath?: string;
      workingDirectory?: string;
  }
  ```
- Add a helper: `isChatFollowUp(p) => isChatPayload(p) && !!p.processId`

### 2. Update exports (`coc-server`)

**File:** `packages/coc-server/src/index.ts`

- Remove re-exports of `ChatFollowUpPayload`, `isChatFollowUpPayload`, `isReadOnlyChatPayload`
- Add re-export for the new `isChatFollowUp` helper if needed

### 3. Update API handler (`coc-server`)

**File:** `packages/coc-server/src/api-handler.ts`

- `POST /api/processes/:id/message` (L1520–1539): enqueue with `type: 'chat'` instead of `type: 'chat-followup'`. Carry `processId`, `parentTaskId`, `attachments`, `imageTempDir`, `workingDirectory` inside the `ChatPayload`. Look up the parent process to inherit `readonly` if it was a readonly chat.
- Remove `QueueExecutorBridge.findTaskByProcessId` usage if `parentTaskId` is now carried through the payload directly (no change in behavior, just cleaner).

### 4. Update queue handler (`coc`)

**File:** `packages/coc/src/server/queue-handler.ts`

- Remove `'readonly-chat'` and `'chat-followup'` from `VALID_TASK_TYPES` set (L29)
- Remove `'readonly-chat'` and `'chat-followup'` entries from `TYPE_LABELS` (L39, L41)
- `generateDisplayName()` (L54): change `payload.kind === 'chat-followup'` check to `payload.kind === 'chat' && payload.processId` for the content-snippet path
- Payload normalization (L172–176): remove the `readonly-chat` special case that sets `kind: 'chat'` — it's always `chat` now
- History filter (L779): remove `|| t.type === 'readonly-chat'` since there's only `chat`
- Active task collection (L788): same cleanup
- Conversation-turns enrichment (L300): remove `t.type !== 'readonly-chat'` branch

### 5. Update executor bridge — scheduling policy (`coc`)

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

- Remove `'readonly-chat'` from `SHARED_TASK_TYPES` (L1495)
- Update `defaultIsExclusive` (L1502–1503):
  ```typescript
  export function defaultIsExclusive(task: QueuedTask): boolean {
      if (task.type === 'chat') {
          return !(task.payload as any)?.readonly;
      }
      return !SHARED_TASK_TYPES.has(task.type);
  }
  ```
- This fixes the existing bug: follow-ups on readonly chats now correctly schedule as shared

### 6. Update executor bridge — execution routing (`coc`)

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

- **Imports** (L20, L25): replace `ChatFollowUpPayload` and `isChatFollowUpPayload` with the new `isChatFollowUp` helper
- **`execute()` pre-cancel** (L182–193): change `isChatFollowUpPayload(task.payload)` to `isChatFollowUp(task.payload)`
- **`execute()` short-circuit** (L198–218): change `isChatFollowUpPayload(task.payload)` to `isChatFollowUp(task.payload)`, cast payload as `ChatPayload` instead of `ChatFollowUpPayload`
- **`buildPrompt()`** (L685–691): change `task.type === 'readonly-chat'` to `(task.payload as any)?.readonly`. Follow-up branch (L755): change `isChatFollowUpPayload` to `isChatFollowUp`
- **`executeByType()`** (L813): change `task.type === 'chat' || task.type === 'readonly-chat'` to `task.type === 'chat'` — it's always `chat` now. Follow-up branch (L827): change `isChatFollowUpPayload` to `isChatFollowUp`
- **Comment header** (L8–14): update supported task types list

### 7. Update SPA — queue tab filtering (`coc`)

**File:** `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx`

- L105, 117, 120, 123: replace `t.type !== 'chat-followup'` with `!(t.type === 'chat' && (t.payload as any)?.processId)` — or extract a helper `isFollowUp(t)` for readability
- L158: simplify `task?.type === 'chat' || task?.type === 'chat-followup'` to `task?.type === 'chat'`
- L594: remove `readonly-chat` from icon mapping — `chat` covers both

### 8. Update SPA — queue stats hook (`coc`)

**File:** `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts`

- L21: change `isHidden` from `t.type === 'chat-followup'` to `t.type === 'chat' && (t as any).payload?.processId`

### 9. Update SPA — task detail panel (`coc`)

**File:** `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`

- L906: change `type === 'chat-followup'` render branch to check `type === 'chat' && payload?.processId`

### 10. Update SPA — chat creation (`coc`)

**Files:**
- `packages/coc/src/server/spa/client/react/chat/NewChatDialog.tsx`
- `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

- Change `type: readOnly ? 'readonly-chat' : 'chat'` to `type: 'chat'` with `payload.readonly: readOnly`
- RepoChatTab L862: change `task?.type === 'readonly-chat'` badge check to `(task?.payload as any)?.readonly`
- RepoChatTab L370: remove `|| t.type === 'readonly-chat'`

### 11. Update tests

**Files (grep for `chat-followup`, `readonly-chat`, `ChatFollowUpPayload`, `isChatFollowUpPayload`):**
- `packages/coc/test/server/follow-up-api.test.ts`
- `packages/coc/test/server/queue-executor-bridge.test.ts`
- `packages/coc/test/server/queue-executor-bridge-followup.test.ts`
- `packages/coc/test/spa/react/RepoChatTab.test.ts`
- `packages/coc/test/spa/react/navigation-integration.test.ts`
- `packages/coc/test/spa/react/repo-queue-split-panel.test.ts`
- `packages/coc/test/spa/react/repo-queue-filter-dropdown.test.ts`
- `packages/coc/test/spa/react/repos/RepoChatTab-improve-chat-input-mobile.test.ts`
- `packages/coc/test/spa/react/useRepoQueueStats.test.tsx`
- `packages/coc/test/helpers/mock-sdk-service.test.ts`

Update all test fixtures and assertions to use `type: 'chat'` with `payload.readonly` / `payload.processId` instead of separate types. Verify scheduling tests confirm readonly follow-ups are shared.

### 12. Update admin panel (`coc`)

**File:** `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`

- The follow-up suggestions toggles (`toggle-chat-followup-enabled`, `input-chat-followup-count`) are about the follow-up *suggestions feature*, not the task type — these should remain unchanged but the `data-testid` names can stay as-is since they refer to the UX feature, not the task type.

## Migration / Compatibility

- No backward compatibility required (per project rules)
- No API versioning needed — the queue API is internal to coc-server
- The `QueueExecutorBridge` interface in `api-handler.ts` can drop `findTaskByProcessId` if `parentTaskId` is always passed through the payload

## Verification

1. `npm run build` — both extension and packages compile
2. `cd packages/coc && npm run test:run` — all 114+ test files pass
3. `cd packages/coc-server && npm run test:run` — all test files pass
4. Manual: start `coc serve`, create a chat, send a follow-up → verify it works
5. Manual: create a readonly chat, send a follow-up → verify it schedules as shared (not exclusive)
