# Retry Strategy for Chat Messages

## Problem

When an AI call fails (e.g., "Copilot session error: retried 5 times"), the error appears
as a dead assistant bubble with no recovery path. Users must manually type the same message
again. The SDK already retries internally (exponential backoff, configurable attempts), but
after exhaustion there is no user-facing escape hatch.

## Proposed Approach

Layer a **UI-driven retry** on top of the existing SDK retry.

---

## Option A — Retry Button on Error Bubbles

**What:** When an assistant bubble is an error (`turn.isError === true`), render a
`↺ Retry` button beside the existing `</>` / copy actions.

**Flow:**
1. `ConversationTurnBubble` receives `onRetry?: () => void` prop.
2. Parent (`RepoChatTab`) passes a handler that calls `sendFollowUp(lastUserMessage)`,
   re-using the existing follow-up path — no new API needed.
3. The failed assistant bubble is replaced optimistically with a new streaming placeholder.

**Why easy:** The follow-up endpoint already exists. Only UI changes + one prop wire-up.

**Limitation:** Only retries the immediately preceding user message. Cannot retry mid-thread
turns.

---

## Acceptance Criteria

- [ ] Error assistant bubbles render a `↺ Retry` button (hidden on success/streaming turns)
- [ ] Clicking Retry re-sends the last user message and streams a new response
- [ ] The error bubble is replaced by the new streaming placeholder
- [ ] Retry is disabled while a follow-up is already in-flight (`sending === true`)
- [ ] `isError` flag is propagated to `ConversationTurn` from SSE `error` events

---

## Subtasks

1. **Mark error turns**: In SSE error handling inside `RepoChatTab`, set
   `turn.isError = true` on the last assistant placeholder when an `error` event arrives.
2. **Add `onRetry` prop**: Wire `ConversationTurnBubble` to accept and render a Retry
   button when `turn.isError && onRetry`.
3. **Handler in RepoChatTab**: `onRetry` calls `sendFollowUp(lastUserTurn.content)` with
   the last user message content.
4. **Tests**: Vitest unit test for error state propagation; manual test against a
   force-failed endpoint.

---

## Notes

- The screenshot error ("retried 5 times") comes from **inside** the SDK/VS Code Copilot
  layer — not from `pipeline-core`'s own `withRetry` (which defaults to 3 attempts). The
  two layers are stacked; Option C would tune the outer layer.
- For Option A, the simplest implementation reuses `sendFollowUp` unchanged — the backend
  doesn't know it's a retry.
- If we want smarter retry (e.g., switch model on retry), that's a separate enhancement and
  should be a new task.
- Read-only chat mode (`readOnly` prop) should **not** show retry buttons — the existing
  `readOnly` guard in `RepoChatTab` can be reused.
- `WikiAsk.tsx` uses a different (simpler) chat component; Option A can be applied there
  separately after the main chat is done.

## Files Likely Touched

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Error state on SSE, `onRetry` handler, `sendFollowUp` call |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | `isError` + `onRetry` prop, Retry button render |
