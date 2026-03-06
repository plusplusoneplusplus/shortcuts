# Fix: Chat Tab Title Shows READONLY_PROMPT_PREFIX Instead of User Message

## Problem

For `readonly-chat` tasks, the conversation tab title (and sidebar preview) always
shows the beginning of the system instruction ("IMPORTANT: You are in read-only
mode…") instead of a meaningful title derived from the user's actual question.

### Root Cause

`extractPrompt()` in `queue-executor-bridge.ts` prepends `READONLY_PROMPT_PREFIX`
directly onto the user's message string before storing it as the first conversation
turn's `content`:

```ts
// queue-executor-bridge.ts ~line 614
if (task.type === 'readonly-chat') {
    return READONLY_PROMPT_PREFIX + prompt;   // ← prefix baked into stored content
}
```

Two downstream consumers both read the poisoned `content` directly:

1. **`generateTitleIfNeeded()`** — sends first 400 chars to the AI title generator,
   which summarises the system instruction, not the user's question.
2. **`enrichChatTasks()`** in `queue-handler.ts` — builds `chatMeta.firstMessage`
   from the same string, so the UI fallback also shows the prefix.

## Proposed Fix

### Option A — Strip prefix at read sites (minimal change, low risk)
Strip `READONLY_PROMPT_PREFIX` from `content` in the two consumers:

- In `generateTitleIfNeeded()` (line 382): strip prefix before passing to the
  AI title generator.
- In `enrichChatTasks()` (line 313–316): strip prefix before building
  `firstMessage`.

**Pros:** Surgical, zero schema change, backwards-compatible with existing processes.  
**Cons:** Two call sites to update; doesn't fix the stored data for old processes.

### Option B — Don't bake prefix into stored content (cleaner architecture)
Keep `READONLY_PROMPT_PREFIX` out of `extractPrompt()` entirely. Instead, prepend
it only when invoking the AI SDK session (inside `executeByType`/`executeChatTask`),
leaving stored `content` as the raw user message.

**Pros:** Stored data is clean; all consumers correct by default.  
**Cons:** Requires tracing where the prompt is forwarded to the SDK to ensure the
prefix is still applied correctly for AI safety.

### Recommended approach
**Option A** first (quick fix, unblocks users immediately), followed by Option B
as a follow-up refactor.

## Scope of Changes

| File | Change |
|------|--------|
| `packages/coc/src/server/queue-executor-bridge.ts` | Strip prefix in `generateTitleIfNeeded()` |
| `packages/coc/src/server/queue-handler.ts` | Strip prefix when building `firstMessage` in `enrichChatTasks()` |
| `packages/coc/test/server/queue-executor-bridge-title.test.ts` | Add test: readonly-chat prompt generates title from user content, not prefix |
| `packages/coc/test/server/queue-handler.test.ts` | Add test: firstMessage strips READONLY_PROMPT_PREFIX |

## Implementation Notes

- `READONLY_PROMPT_PREFIX` is exported from `queue-executor-bridge.ts` — import it
  in `queue-handler.ts` where needed.
- The strip is a simple `content.startsWith(READONLY_PROMPT_PREFIX) ? content.slice(READONLY_PROMPT_PREFIX.length) : content` guard.
- Existing processes with poisoned titles in the store are **not** retroactively
  fixed (titles are idempotent: once set they don't regenerate). A separate
  migration/wipe could address those, but is out of scope.

## Out of Scope

- Migrating already-stored processes with bad titles.
- Option B architectural refactor (separate follow-up).
- Any UI changes.
