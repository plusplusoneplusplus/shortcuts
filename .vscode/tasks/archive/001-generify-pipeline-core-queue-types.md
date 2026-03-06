---
status: done
---

# 001: Generify pipeline-core Queue Types

## Summary

Remove all domain-specific task types, payload interfaces, and type guard functions from `pipeline-core/src/queue/types.ts`, leaving `QueuedTask` with a generic `type: string` and `payload: Record<string, unknown>`. This is the first of three commits that migrate domain-specific queue types out of pipeline-core into their consuming packages.

## Motivation

`pipeline-core` is a shared, pure Node.js package that should not encode domain-specific concepts like `FollowPromptPayload` or `CodeReviewPayload`. These belong in the VS Code extension and CoC packages that actually define and consume them. Commit 1 focuses solely on pipeline-core internals — stripping the types at their source and fixing pipeline-core's own tests. Subsequent commits (002, 003) will migrate the type guards and payload interfaces to their consumers (`src/shortcuts/ai-service/` and `packages/coc/`).

## Changes

### Files to Create

- (none)

### Files to Modify

- **`packages/pipeline-core/src/queue/types.ts`** — The authoritative source of all removals:
  1. Delete `TaskType` union (lines 17–24).
  2. Delete all 7 payload interfaces: `FollowPromptPayload` (49–66), `ResolveCommentsPayload` (71–86), `CodeReviewPayload` (91–102), `AIClarificationPayload` (107–136), `TaskGenerationPayload` (141–162), `RunPipelinePayload` (167–180), `CustomTaskPayload` (185–190).
  3. Delete `TaskPayload` union type (lines 195–202).
  4. Delete all 7 type guard functions: `isFollowPromptPayload` (559–561), `isResolveCommentsPayload` (566–568), `isCodeReviewPayload` (573–575), `isAIClarificationPayload` (580–582), `isCustomTaskPayload` (587–589), `isTaskGenerationPayload` (594–596), `isRunPipelinePayload` (601–603).
  5. Change `QueuedTask` generic (line 247): from `QueuedTask<TPayload extends TaskPayload = TaskPayload, TResult = unknown>` to a non-generic `QueuedTask` with `payload: Record<string, unknown>`.
  6. Change `QueuedTask.type` (line 255): from `type: TaskType` to `type: string`.
  7. Simplify `CreateTaskInput` (line 292): remove the `TPayload` generic parameter; it no longer extends `TaskPayload`.
  8. Simplify `TaskUpdate` (line 300): remove the `TPayload` and `TResult` generic parameters.
  9. Remove the "Payload Types" and "Type Guards" section headers/comments for cleanliness.

- **`packages/pipeline-core/src/queue/task-queue-manager.ts`** — Update imports:
  - Line 18: remove `TaskPayload` import.
  - Line 67: remove `<TPayload extends TaskPayload = TaskPayload>` generic from `enqueue` method signature; accept `CreateTaskInput` directly.

- **`packages/pipeline-core/src/queue/index.ts`** — Remove re-exports:
  - Remove `TaskType` (line 59).
  - Remove all 7 payload interfaces (lines 64–71): `FollowPromptPayload`, `ResolveCommentsPayload`, `CodeReviewPayload`, `AIClarificationPayload`, `TaskGenerationPayload`, `RunPipelinePayload`, `CustomTaskPayload`, `TaskPayload`.
  - Remove all 7 type guard re-exports (lines 110–116): `isFollowPromptPayload`, `isResolveCommentsPayload`, `isCodeReviewPayload`, `isAIClarificationPayload`, `isTaskGenerationPayload`, `isRunPipelinePayload`, `isCustomTaskPayload`.
  - Update the module-doc `@example` (lines 39–42) to use `type: 'follow-prompt'` string literal instead of referencing the removed type.

- **`packages/pipeline-core/src/index.ts`** — Remove re-exports from the "Queue System" section (lines 619–695):
  - Remove `TaskType` (line 621).
  - Remove all 7 payload interface exports (lines 626–633).
  - Remove `TaskPayload` (line 634).
  - Remove all 7 type guard exports (lines 672–678).

- **`packages/pipeline-core/test/queue/queue-types.test.ts`** — Rewrite substantially:
  - Remove all imports of deleted types: `isFollowPromptPayload`, `isRunPipelinePayload`, `isResolveCommentsPayload`, `FollowPromptPayload`, `RunPipelinePayload`, `ResolveCommentsPayload`, `AIClarificationPayload`, `CustomTaskPayload`, `TaskGenerationPayload` (lines 7–16).
  - Delete `FollowPromptPayload — folderPath field` describe block (lines 19–49) — tests payload interface shape.
  - Delete `RunPipelinePayload — type and guard` describe block (lines 70–135) — tests `isRunPipelinePayload` guard.
  - Delete `ResolveCommentsPayload` describe block (lines 137–178) — tests `isResolveCommentsPayload` guard.
  - Retain `QueuedTask — folderPath field` describe block (lines 51–68), updating it to use `QueuedTask` with the new untyped payload (`Record<string, unknown>`).

- **`packages/pipeline-core/test/queue/task-queue-manager.test.ts`** — Update type references:
  - Remove `FollowPromptPayload`, `CodeReviewPayload`, `AIClarificationPayload` from imports (lines 16–18).
  - Lines 1642–1650: replace `FollowPromptPayload` type annotation with inline object literal; replace `as FollowPromptPayload` casts with `as Record<string, unknown>` or `as any`.
  - Lines 1652–1663: replace `CodeReviewPayload` type annotation and cast.
  - Lines 1666–1676: replace `AIClarificationPayload` type annotation and cast.
  - Lines 1679–1685: replace `FollowPromptPayload` type annotation and cast.
  - `createTestTask` helper (line 1693): update the `CreateTaskInput` usage — the payload field becomes `Record<string, unknown>`.

### Files to Delete

- (none)

## Implementation Notes

- **No backward compatibility required** — consumers will break and are fixed in commits 002/003.
- **`QueuedTask.payload` becomes `Record<string, unknown>`** — this is the simplest generic shape. Consumers that need type safety will define their own typed wrappers or use `as` casts.
- **`QueuedTask` loses its generic parameters** — `QueuedTask<TPayload, TResult>` becomes just `QueuedTask`. The `payload` field is `Record<string, unknown>` and `result` remains `unknown`. This simplifies all downstream code that references `QueuedTask` without needing to parametrize it.
- **`CreateTaskInput` and `TaskUpdate` also lose generics** for consistency.
- **The `task-queue-manager.ts` file** only imports `TaskPayload` (line 18) for the generic bound on `enqueue`. After removing the generic, this import is deleted.
- **External consumers that will break** (fixed in later commits):
  - `src/shortcuts/ai-service/ai-queue-service.ts` — imports `TaskPayload`, `isFollowPromptPayload`, `isAIClarificationPayload`, `FollowPromptPayload`, `AIClarificationPayload`
  - `packages/coc/src/server/queue-executor-bridge.ts` — imports all 6 type guards + `TaskGenerationPayload`, `RunPipelinePayload`, `ResolveCommentsPayload`
  - `packages/coc/test/server/task-generation-queue.test.ts` — imports 5 type guards
- **Only pipeline-core's build and tests must pass** at the end of this commit. Other packages will fail to compile — that is expected and handled by commits 002 and 003.

## Tests

- `test/queue/queue-types.test.ts` — Remove all describe blocks that test deleted type guards and payload interfaces. Keep the `QueuedTask — folderPath field` tests with updated typings.
- `test/queue/task-queue-manager.test.ts` — Replace typed payload annotations with inline object literals. All existing behavioral tests for enqueue/dequeue/priority/events remain unchanged.
- Run: `cd packages/pipeline-core && npm run test:run` to confirm pipeline-core tests pass.
- Run: `cd packages/pipeline-core && npm run build` to confirm pipeline-core compiles.

## Acceptance Criteria

- [x] `TaskType` union type no longer exists in `types.ts`
- [x] All 7 payload interfaces removed from `types.ts`
- [x] `TaskPayload` union removed from `types.ts`
- [x] All 7 type guard functions removed from `types.ts`
- [x] `QueuedTask.type` is `string` (not `TaskType`)
- [x] `QueuedTask.payload` is `Record<string, unknown>` (not generic `TPayload`)
- [x] `QueuedTask`, `CreateTaskInput`, and `TaskUpdate` have no generic type parameters
- [x] `queue/index.ts` and `src/index.ts` do not export any removed symbols
- [x] `packages/pipeline-core` builds cleanly (`npm run build`)
- [x] `packages/pipeline-core` tests pass (`npm run test:run`)

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit.
