# Read-Only Chat Toggle

## Problem

Chat sessions currently always run as **exclusive** tasks (serialized, concurrency = 1) and have full tool access, meaning the AI can modify files. Users want a lightweight "read-only" mode for exploratory questions where the AI should only read/analyze code — never modify it. Read-only chats should also skip the exclusive lock so they can run concurrently alongside other tasks.

## Proposed Approach

Add a **"Read-only" toggle** to the chat start screen (next to the model selector, in the area circled in the screenshot). When enabled:

1. **Prompt injection** — Prepend a read-only system instruction to the user's prompt before sending to the AI.
2. **Shared execution** — Treat the task as non-exclusive so it uses the shared limiter (concurrent) instead of the exclusive limiter (serialized).

### Read-Only Prompt Prefix

```
IMPORTANT: You are in read-only mode. You MUST NOT create, edit, delete, or modify any files or source code. Only use read-only tools (grep, glob, view, cat, find, ls). If the user asks you to make changes, explain what changes would be needed but do not execute them.

```

This prefix is prepended to the user's first message. Follow-up messages in the same session inherit the mode (no re-injection needed since the AI retains context).

---

## Changes Required

### 1. Frontend — `RepoChatTab.tsx`
**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

- Add `readOnly` boolean state (default: `false`), persisted via `usePreferences` (same as model).
- Add a toggle/checkbox in `renderStartScreen()` in the controls row (next to model selector, before Start Chat button).
- When `readOnly` is enabled, send `type: 'readonly-chat'` instead of `type: 'chat'` in the `POST /api/queue` body.
- Show a visual indicator (badge/pill) in the chat header when a session is read-only.

**UI placement** (in the `flex items-center gap-2` row):
```
[Read-only toggle] [Model selector ▾] [Start Chat]
```

### 2. New task type — `readonly-chat`
**File:** `packages/coc-server/src/task-types.ts`

- Add `'readonly-chat'` to the `TaskType` union:
  ```ts
  type TaskType =
      | 'follow-prompt'
      | 'resolve-comments'
      | 'code-review'
      | 'ai-clarification'
      | 'chat'
      | 'readonly-chat'
      | 'task-generation'
      | 'run-pipeline'
      | 'custom';
  ```
- Add an `isReadOnlyChatPayload` type guard (mirrors `isChatPayload` but checks for `type` at the task level, reuses the same `ChatPayload` shape).

### 3. Queue handler — accept new type
**File:** `packages/coc/src/server/queue-handler.ts`

- Add `'readonly-chat'` to `VALID_TASK_TYPES` so it passes validation.
- Ensure `readonly-chat` tasks reuse the same `ChatPayload` parsing path as `chat`.

### 4. Prompt injection — `queue-executor-bridge.ts`
**File:** `packages/coc/src/server/queue-executor-bridge.ts`

- In `extractPrompt()`: if `task.type === 'readonly-chat'`, prepend the read-only instruction to the prompt.
- In `executeByType()`: route `readonly-chat` tasks through the same chat execution path as `chat`.

### 5. Shared execution — `queue-executor-bridge.ts`
**File:** `packages/coc/src/server/queue-executor-bridge.ts`

- Add `'readonly-chat'` to the `SHARED_TASK_TYPES` set so it is automatically non-exclusive:
  ```ts
  const SHARED_TASK_TYPES: ReadonlySet<string> = new Set([
      'task-generation',
      'ai-clarification',
      'code-review',
      'readonly-chat',
  ]);
  ```
- `defaultIsExclusive()` remains unchanged — it already returns `false` for any type in `SHARED_TASK_TYPES`.

### 6. Preferences persistence (optional enhancement)
**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

- Persist the read-only toggle state in preferences so it remembers the user's last choice (similar to model persistence).

---

## Files Touched

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Add toggle UI + state + send `type: 'readonly-chat'` in API call |
| `packages/coc-server/src/task-types.ts` | Add `'readonly-chat'` to `TaskType` union |
| `packages/coc/src/server/queue-handler.ts` | Add `'readonly-chat'` to `VALID_TASK_TYPES` |
| `packages/coc/src/server/queue-executor-bridge.ts` | Prompt prefix injection + add to `SHARED_TASK_TYPES` |

---

## Testing

- **Unit test:** `defaultIsExclusive` returns `false` for `readonly-chat` tasks (already covered by `SHARED_TASK_TYPES` membership).
- **Unit test:** `extractPrompt` prepends the read-only instruction when `task.type === 'readonly-chat'`.
- **Unit test:** Queue handler accepts `readonly-chat` as a valid task type.
- **UI test:** Toggle renders, sends `type: 'readonly-chat'` in API payload.
- **Integration:** Read-only chat runs concurrently (doesn't block or get blocked by exclusive tasks).

---

## Out of Scope

- Tool-level whitelisting (`availableTools: ['grep', 'glob', 'view']`) — could be a future hardening step but the prompt instruction is sufficient for v1.
- Read-only mode for follow-up messages in the same session (inherited from first message context).
- Converting an active chat between read-only and read-write modes.
