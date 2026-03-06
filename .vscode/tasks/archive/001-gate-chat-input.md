---
status: pending
---

# 001: Gate Chat Input on sdkSessionId

## Summary
Hide or replace the chat input bar with a static footer message when a process has no `sdkSessionId` and is in a terminal state (`completed`/`failed`). This prevents users from attempting follow-up messages on pipeline executions that lack an SDK session, which currently results in broken 409 errors server-side.

## Motivation
Pipeline executions (as opposed to interactive chat tasks) do not have an `sdkSessionId` because they are not backed by a Copilot SDK session. When a user tries to send a follow-up message on such a process, the server returns a 409 error because there is no session to resume. This commit gates the chat input UI at the client level so the broken interaction never occurs. `QueueTaskDetail.tsx` already implements this pattern (lines 477–478, 604–610); the other two SPA paths need the same treatment.

## Changes

### Files to Create
- (none expected)

### Files to Modify

- `packages/coc/src/server/spa/client/detail.ts` — Gate the chat-hint banner (lines 929–934) and the chat-input-bar div (lines 936–946) on `sdkSessionId` presence for terminal processes. When a terminal process has no session, render a static footer instead.

- `packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx` — Add a chat input area (or a "not available" footer) to the bottom of the detail view, gated on `resumeSessionId` and terminal status. Currently this component has **no** follow-up input at all (it ends at line 281 with just conversation turns), so the footer message is the only addition needed.

- `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — This component is a **repo-scoped chat tab** that always creates its own chat tasks (type `'chat'`), so it always has a session. No changes needed here; all processes created through this tab inherently have `sdkSessionId`. The 409 issue does not apply.

- `packages/coc/test/spa/react/detail-legacy.test.ts` — Add source-based assertions that `detail.ts` checks `sdkSessionId` / terminal status before rendering `chat-input-bar`.

### Files to Delete
- (none expected)

## Implementation Notes

### Legacy SPA (`detail.ts`)

**Where the gating logic goes:** Inside `renderQueueTaskConversation()` (line 774), between the conversation body close (line 927) and the chat-hint/input-bar rendering (lines 929–946).

**Key variables available at that point:**
- `proc` — the full process object (nullable), fetched at line 556 via `fetchApi('/processes/...')`
- `status` — string, derived from `proc.status` at line 786 (defaults to `'running'`)
- `isRunning` — boolean, `status === 'running' || status === 'queued'` (line 830)
- `proc.sdkSessionId` — the SDK session ID field, already checked at line 102 for metadata display

**Proposed logic (insert before line 929):**
```typescript
const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';
const hasSession = !!(proc && proc.sdkSessionId);
const showChatInput = !isTerminal || hasSession;
```

**Chat-hint gate (lines 929–934):** Wrap the existing hint rendering in `showChatInput`:
```typescript
if (showChatInput && !localStorage.getItem('coc-chat-hint-dismissed') && !isRunning) {
    html += '<div id="chat-hint" class="chat-hint">...';
}
```

**Chat-input-bar gate (lines 936–946):** Replace with conditional:
```typescript
if (showChatInput) {
    // existing chat-input-bar HTML (lines 937–946)
} else {
    html += '<div class="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">' +
        '<div class="text-[#848484] text-sm text-center">' +
        'Pipeline completed · follow-up chat not available</div></div>';
}
```

Note: The `isTerminal` variable already exists at line 155 in `renderProcessDetail()` but **not** in `renderQueueTaskConversation()`. We need to compute it locally using the `status` variable that's already in scope at line 786.

**Edge case — `proc` is null:** When `proc` is null (line 600 catch path), `status` defaults to `'running'` via queue state lookup (line 799) or empty string. In this case `showChatInput` will be `true` (not terminal), so the input bar renders normally. This is correct because we haven't fetched the process yet.

**`setInputBarDisabled` function (line 1304):** This function queries `document.querySelector('.chat-input-bar')` — when we skip rendering the bar, it simply won't find the element and will no-op. No changes needed.

### React SPA (`ProcessDetail.tsx`)

This component (line 57–284) renders process details with conversation turns but has **no follow-up chat input**. It only has a "Resume CLI" button (lines 227–236) which is already gated on `resumeSessionId` (line 175, derived from `getSessionIdFromProcess(metadataProcess)`).

**What to add:** A footer bar after the conversation turns section (after the closing `</div>` at line 281), similar to the pattern in `QueueTaskDetail.tsx` lines 604–610:
```tsx
{process.status !== 'running' && process.status !== 'queued' && !resumeSessionId && (
    <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
        <div className="text-[#848484] text-sm text-center">
            Follow-up chat is not available for this process type.
        </div>
    </div>
)}
```

This mirrors the exact pattern from `QueueTaskDetail.tsx` line 604–609 (`noSessionForFollowUp` variable at line 478).

### React SPA (`RepoChatTab.tsx`) — No changes needed

`RepoChatTab` is a **repo-scoped chat creation** component. It creates new queue tasks of `type: 'chat'` (visible at the POST to `/queue` endpoint). These tasks always have SDK sessions because they are interactive chat sessions. The follow-up send path (line 232–277 `sendFollowUp()`) correctly handles 410 session expiry. There is no scenario where a pipeline execution would appear in `RepoChatTab` — it only shows its own created chat tasks.

### React SPA (`QueueTaskDetail.tsx`) — Already implemented

Lines 477–478 already compute `noSessionForFollowUp`:
```typescript
const isTerminal = task?.status === 'completed' || task?.status === 'failed';
const noSessionForFollowUp = isTerminal && processDetails !== null && !resumeSessionId;
```

Lines 604–610 render the static footer when `noSessionForFollowUp` is true:
```tsx
{!isPending && noSessionForFollowUp && (
    <div className="border-t ..."><div className="text-[#848484] ...">
        Follow-up chat is not available for this process type.
    </div></div>
)}
```

No changes needed here.

### CSS / Styling

- The footer message in the legacy SPA should use Tailwind utility classes consistent with the React SPA pattern (`border-t`, `p-3`, `text-[#848484]`, `text-sm`, `text-center`). Since `detail.ts` outputs raw HTML strings (not JSX), use the equivalent CSS class names directly in the HTML string.
- No new CSS definitions are needed in `tailwind.css` — the Tailwind utility classes are already available in the compiled `bundle.css`.

### `getSessionIdFromProcess` helper

Defined in `ConversationMetadataPopover.tsx` (line 42–47):
```typescript
export function getSessionIdFromProcess(process: any): string | null {
    if (!process) return null;
    return toStringValue(process.sdkSessionId)
        || toStringValue(process.sessionId)
        || parseSessionIdFromResult(process.result);
}
```

This checks three sources: `sdkSessionId`, `sessionId`, and a parsed session ID from the `result` JSON. In `ProcessDetail.tsx`, this is already called at line 175 as `resumeSessionId`. In `detail.ts`, we can use the simpler `proc.sdkSessionId` check directly since the legacy SPA doesn't import from the React tree.

## Tests

### Existing tests (should still pass, no changes)
- `packages/coc/test/server/api-handler.test.ts` — server-side 409 tests remain unchanged (server logic is not modified)
- `packages/coc/test/spa/react/RepoChatTab.test.ts` — source-based assertions about follow-up send, session expiry (410), and UI elements remain valid since `RepoChatTab.tsx` is unchanged
- `packages/coc/test/spa/react/ConversationMetadataPopover.test.tsx` — `getSessionIdFromProcess` tests remain valid

### Tests to update
- `packages/coc/test/spa/react/detail-legacy.test.ts` — Currently only tests for `TODO(chat-image-attach)` comment and React QueueTaskDetail reference. Add new assertions:
  - Source contains `sdkSessionId` check near the chat-input-bar rendering
  - Source contains `'Pipeline completed'` or `'follow-up chat not available'` footer text
  - Source gates `chat-hint` rendering on `showChatInput`

### Tests to verify (no updates expected)
- `packages/coc/test/e2e/queue-conversation.spec.ts` — E2E tests for queue conversation flow; should not be affected since chat tasks always have sessions
- `packages/coc/test/e2e/queue-conversation-mock.spec.ts` — Mock-based queue conversation E2E; same reasoning

## Acceptance Criteria
- [ ] Legacy SPA (`detail.ts`): terminal processes without `sdkSessionId` show "Pipeline completed · follow-up chat not available" footer instead of the chat input bar
- [ ] Legacy SPA (`detail.ts`): the "💡 You can send follow-up messages" hint is hidden when chat input is hidden
- [ ] Legacy SPA (`detail.ts`): running/queued processes still show the chat input bar regardless of `sdkSessionId` (they may not have it yet)
- [ ] Legacy SPA (`detail.ts`): terminal processes **with** `sdkSessionId` still show the normal chat input bar
- [ ] React SPA (`ProcessDetail.tsx`): terminal processes without session show the "not available" footer
- [ ] React SPA (`ProcessDetail.tsx`): "Resume CLI" button remains gated on `resumeSessionId` (already done, verify not regressed)
- [ ] React SPA (`QueueTaskDetail.tsx`): existing `noSessionForFollowUp` gating is preserved (no changes, verify not regressed)
- [ ] React SPA (`RepoChatTab.tsx`): no changes, follow-up flow works as before
- [ ] All existing tests in `packages/coc/test/spa/` pass
- [ ] New source assertions in `detail-legacy.test.ts` pass
- [ ] `npm run build` succeeds

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit.
