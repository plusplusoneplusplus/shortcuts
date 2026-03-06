---
status: done
---

# 000: Add Dedicated Chat Task Type

## Summary

Add `chat` as a first-class `TaskType` with its own payload, type guard, and execution path so interactive SPA conversations are no longer conflated with `ai-clarification` tasks. This is a prerequisite for the shared/exclusive concurrency model where `chat` must always be `shared`.

## Motivation

When a user sends a message via the SPA chat (`localhost:4000/#repos/<id>/chat`), `queue-handler.ts` wraps it as `type: 'ai-clarification'` (line 407). This conflates two semantically distinct use cases:

- **Chat** — interactive conversation, read-only, no file modifications; should never block or be blocked.
- **AI Clarification** — targeted clarification about code, may involve file context, selected text, skill routing.

The upcoming shared/exclusive concurrency model needs to distinguish these: `chat` tasks will always run with `shared` concurrency (never blocks, never blocked), while `ai-clarification` remains `exclusive`. Making `chat` its own type now keeps that follow-up commit clean.

The SPA already partially supports `chat` — `VALID_TASK_TYPES` (line 28), `TYPE_LABELS` (line 35), and `RepoQueueTab.tsx` (lines 29-30) already reference `'chat'`. What's missing is the core type definition and the wiring to actually use it.

## Changes

### Files to Create

- (none)

### Files to Modify

1. **`packages/pipeline-core/src/queue/types.ts`** — Core type definitions
   - **Line 17-24** (`TaskType` union): Add `| 'chat'` to the union.
   - **After `AIClarificationPayload` (line ~136)**: Add `ChatPayload` interface with a `kind: 'chat'` discriminant:
     ```ts
     export interface ChatPayload {
         readonly kind: 'chat';
         prompt: string;
         workspaceId?: string;
         folderPath?: string;
     }
     ```
   - **Lines 195-202** (`TaskPayload` union): Add `| ChatPayload`.
   - **After `isAIClarificationPayload` (line ~582)**: Add `isChatPayload` type guard:
     ```ts
     export function isChatPayload(payload: TaskPayload): payload is ChatPayload {
         return (payload as any).kind === 'chat';
     }
     ```
     Uses `kind` discriminant — same pattern as `isTaskGenerationPayload` and `isRunPipelinePayload`. This avoids collision with `isAIClarificationPayload`'s fragile `'prompt' in payload` heuristic.

2. **`packages/pipeline-core/src/queue/index.ts`** — Re-export
   - Add `ChatPayload` to the payload type re-exports (near lines 57-120).
   - Add `isChatPayload` to the type guard re-exports (near lines 110-116).

3. **`packages/pipeline-core/src/index.ts`** — Public API re-export
   - Add `ChatPayload` to payload re-exports (near lines 625-633).
   - Add `isChatPayload` to type guard re-exports (near lines 672-678).

4. **`packages/coc/src/server/queue-handler.ts`** — Legacy dialog default
   - **Line 407**: Change `type: 'ai-clarification'` → `type: 'chat'`.
   - **Payload construction (~line 409)**: Add `kind: 'chat'` discriminant to the payload object so `isChatPayload` matches and `isAIClarificationPayload` does not.

5. **`packages/coc/src/server/queue-executor-bridge.ts`** — Execution wiring
   - **Lines 29-34** (imports): Add `isChatPayload` to the import from `pipeline-core`.
   - **Lines 1-17** (header comment): Add `chat` to the supported task types list.
   - **`extractPrompt()` (line ~475)**: Add a `isChatPayload` branch before `isAIClarificationPayload`:
     ```ts
     if (isChatPayload(task.payload)) {
         return task.payload.prompt || task.displayName || 'Chat message';
     }
     ```
     Must come **before** `isAIClarificationPayload` because `ChatPayload` also has `prompt`, and without the `kind` check order, the AI clarification guard would match.
   - **`executeByType()` (line ~563)**: Add `isChatPayload` to the existing AI execution condition:
     ```ts
     if (isAIClarificationPayload(...) || isChatPayload(...) || isCustomTaskPayload(...) || isFollowPromptPayload(...))
     ```
   - **`getWorkingDirectory()` (line ~861)**: Add `isChatPayload` handling — use `task.payload.folderPath` if present, similar to `isAIClarificationPayload`.

6. **`packages/coc/src/server/spa/client/queue.ts`** — SPA payload builder
   - **Lines 459-463** (payload ternary): Add `chat` arm:
     ```ts
     type === 'chat'
         ? { kind: 'chat', prompt: prompt || displayName || 'Chat message' }
         : type === 'ai-clarification'
             ? { prompt: prompt || displayName || 'AI clarification task' }
             : ...
     ```
   - **Lines 466-471** (workingDirectory injection): Also apply for `type === 'chat'`.

7. **`packages/coc/src/server/spa/client/detail.ts`** — Legacy SPA detail rendering
   - **Line ~461** (rendering blocks): Add `type === 'chat'` block before or alongside `ai-clarification`. Render the prompt; no metadata grid needed (chat payloads lack filePath/skillName/etc).

8. **`packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`** — React SPA detail
   - **Line ~827** (rendering branches): Add `if (type === 'chat')` branch. Render `payload.prompt` in a simple block (no skill/filePath metadata).

### Files to Delete

- (none)

## Implementation Notes

### The `kind` discriminant is critical

`isAIClarificationPayload` (line 580-582) uses a fragile heuristic: `'prompt' in payload && !('data' in payload)`. Since `ChatPayload` also has a `prompt` field, without a discriminant `isAIClarificationPayload` would match chat payloads.

The `kind: 'chat'` discriminant solves this cleanly:
- `isChatPayload` checks `(payload as any).kind === 'chat'` — only matches `ChatPayload`.
- `isAIClarificationPayload` still works because `AIClarificationPayload` has no `kind` field, and `ChatPayload` has `kind` so the order in dispatch chains doesn't actually matter at the type-guard level. However, **order `isChatPayload` before `isAIClarificationPayload`** in dispatch chains (like `extractPrompt`) as a defense-in-depth measure.

This follows the same pattern as `TaskGenerationPayload` (`kind: 'task-generation'`) and `RunPipelinePayload` (`kind: 'run-pipeline'`).

### Execution path is identical to `ai-clarification`

`chat` tasks follow the same `executeWithAI()` path. The only behavioral difference will come in a later commit when concurrency policies are applied.

### SPA already knows about `chat`

`VALID_TASK_TYPES`, `TYPE_LABELS`, and `RepoQueueTab.tsx` already handle `'chat'`. The missing pieces are the core type system and the executor bridge — that's what this commit adds.

## Tests

1. **`packages/pipeline-core/test/queue/queue-types.test.ts`** — Add `isChatPayload` tests:
   - Positive: `{ kind: 'chat', prompt: 'hello' }` → `true`
   - Positive with optionals: `{ kind: 'chat', prompt: 'hello', workspaceId: 'ws1', folderPath: '/tmp' }` → `true`
   - Negative against `AIClarificationPayload`: `{ prompt: 'hello' }` (no `kind`) → `false`
   - Negative against `RunPipelinePayload`: `{ kind: 'run-pipeline', ... }` → `false`
   - Verify `isAIClarificationPayload` does NOT match a `ChatPayload` (defense test)

2. **`packages/coc/test/server/queue-executor-bridge.test.ts`** — Add chat execution test:
   - Submit a task with `type: 'chat'`, `payload: { kind: 'chat', prompt: 'What does this repo do?' }`
   - Verify it reaches `executeWithAI()` (mock `getCopilotSDKService` is called)
   - Verify `extractPrompt()` returns the prompt string
   - Verify the task completes successfully

## Acceptance Criteria

- [ ] `TaskType` union includes `'chat'`
- [ ] `ChatPayload` interface exists with `kind: 'chat'` discriminant
- [ ] `ChatPayload` is in the `TaskPayload` union
- [ ] `isChatPayload()` type guard works and is exported from `pipeline-core`
- [ ] `isChatPayload` does NOT match `AIClarificationPayload` objects (no false positives)
- [ ] `isAIClarificationPayload` does NOT match `ChatPayload` objects (no false positives)
- [ ] Legacy SPA dialog default sends `type: 'chat'` instead of `type: 'ai-clarification'`
- [ ] Chat tasks execute via `executeWithAI()` in the executor bridge
- [ ] SPA payload builder creates correct `ChatPayload` shape with `kind: 'chat'`
- [ ] SPA detail views render chat tasks (both legacy and React)
- [ ] All existing tests pass (no regressions)
- [ ] New `isChatPayload` tests pass
- [ ] New executor bridge chat test passes
- [ ] `npm run build` succeeds

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is a standalone prerequisite. The SPA already partially supports `chat` in `VALID_TASK_TYPES`, `TYPE_LABELS`, and `RepoQueueTab.tsx`.
