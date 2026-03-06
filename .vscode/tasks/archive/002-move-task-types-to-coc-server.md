---
status: done
---

# 002: Move Task Types to coc-server

## Summary

Create `packages/coc-server/src/task-types.ts` with the domain-specific `TaskType` union, 6 payload interfaces (dropping unused `CodeReviewPayload`), the `TaskPayload` union, and 6 type guard functions, then re-point all coc imports to `@plusplusoneplusplus/coc-server`.

## Motivation

After commit 001 generified pipeline-core's queue types (making `QueuedTask.type` a plain `string` and removing all payload types/guards from pipeline-core), the domain-specific types have no home. They belong in coc-server because coc-server is the execution layer that interprets task payloads — pipeline-core should remain domain-agnostic.

## Changes

### Files to Create

- **`packages/coc-server/src/task-types.ts`** — New module containing:
  - `TaskType` union: `'follow-prompt' | 'resolve-comments' | 'code-review' | 'ai-clarification' | 'task-generation' | 'run-pipeline' | 'custom'`
  - `FollowPromptPayload` interface (fields: `repoId?`, `promptFilePath?`, `promptContent?`, `planFilePath?`, `skillName?`, `additionalContext?`, `workingDirectory?`, `folderPath?`)
  - `ResolveCommentsPayload` interface (fields: `repoId?`, `documentUri`, `commentIds`, `promptTemplate`, `workingDirectory?`, `documentContent`, `filePath`)
  - `AIClarificationPayload` interface (fields: `repoId?`, `prompt?`, `workingDirectory?`, `model?`, `selectedText?`, `filePath?`, `startLine?`, `endLine?`, `surroundingLines?`, `nearestHeading?`, `instructionType?`, `customInstruction?`, `promptFileContent?`, `skillName?`)
  - `TaskGenerationPayload` interface (discriminant: `readonly kind: 'task-generation'`; fields: `workingDirectory`, `prompt`, `targetFolder?`, `name?`, `model?`, `depth?`, `mode?`, `images?`, `workspaceId?`)
  - `RunPipelinePayload` interface (discriminant: `readonly kind: 'run-pipeline'`; fields: `pipelinePath`, `workingDirectory`, `model?`, `params?`, `workspaceId?`)
  - `CustomTaskPayload` interface (fields: `repoId?`, `data`)
  - `TaskPayload` union of the 6 interfaces above (no `CodeReviewPayload`)
  - `isFollowPromptPayload(payload): payload is FollowPromptPayload` — checks `'promptFilePath' in payload || 'promptContent' in payload`
  - `isResolveCommentsPayload(payload): payload is ResolveCommentsPayload` — checks `'documentUri' in payload && 'commentIds' in payload`
  - `isAIClarificationPayload(payload): payload is AIClarificationPayload` — checks `'prompt' in payload && !('data' in payload)`
  - `isCustomTaskPayload(payload): payload is CustomTaskPayload` — checks `'data' in payload`
  - `isTaskGenerationPayload(payload): payload is TaskGenerationPayload` — checks `(payload as any).kind === 'task-generation'`
  - `isRunPipelinePayload(payload): payload is RunPipelinePayload` — checks `(payload as any).kind === 'run-pipeline'`

### Files to Modify

- **`packages/coc-server/src/index.ts`** — Add barrel export:
  ```ts
  // Task types (domain-specific payload types and guards)
  export {
      type TaskType,
      type FollowPromptPayload,
      type ResolveCommentsPayload,
      type AIClarificationPayload,
      type TaskGenerationPayload,
      type RunPipelinePayload,
      type CustomTaskPayload,
      type TaskPayload,
      isFollowPromptPayload,
      isResolveCommentsPayload,
      isAIClarificationPayload,
      isCustomTaskPayload,
      isTaskGenerationPayload,
      isRunPipelinePayload,
  } from './task-types';
  ```

- **`packages/coc/src/server/queue-executor-bridge.ts`** — Two import changes:
  1. Remove the 6 type guards (`isFollowPromptPayload`, `isAIClarificationPayload`, `isCustomTaskPayload`, `isTaskGenerationPayload`, `isRunPipelinePayload`, `isResolveCommentsPayload`) from the value import block at lines 22–48 (`import { ... } from '@plusplusoneplusplus/pipeline-core'`).
  2. Remove `TaskGenerationPayload`, `RunPipelinePayload`, `ResolveCommentsPayload` from the type-only import at line 49 (`import type { ... } from '@plusplusoneplusplus/pipeline-core'`).
  3. Add a new import from coc-server (extend the existing coc-server import at line 51):
     ```ts
     import {
         saveImagesToTempFiles, cleanupTempDir,
         isFollowPromptPayload, isAIClarificationPayload, isCustomTaskPayload,
         isTaskGenerationPayload, isRunPipelinePayload, isResolveCommentsPayload,
     } from '@plusplusoneplusplus/coc-server';
     import type {
         TaskGenerationPayload, RunPipelinePayload, ResolveCommentsPayload,
     } from '@plusplusoneplusplus/coc-server';
     ```

- **`packages/coc/src/server/pipelines-handler.ts`** — Change line 17:
  - Before: `import type { CreateTaskInput, RunPipelinePayload } from '@plusplusoneplusplus/pipeline-core';`
  - After: split into two imports — keep `CreateTaskInput` on pipeline-core, move `RunPipelinePayload` to coc-server:
    ```ts
    import type { CreateTaskInput } from '@plusplusoneplusplus/pipeline-core';
    import type { RunPipelinePayload } from '@plusplusoneplusplus/coc-server';
    ```

- **`packages/coc/src/server/task-generation-handler.ts`** — Change line 18:
  - Before: `import type { ProcessStore, CreateTaskInput, TaskGenerationPayload } from '@plusplusoneplusplus/pipeline-core';`
  - After: keep `ProcessStore` and `CreateTaskInput` on pipeline-core, move `TaskGenerationPayload` to coc-server:
    ```ts
    import type { ProcessStore, CreateTaskInput } from '@plusplusoneplusplus/pipeline-core';
    import type { TaskGenerationPayload } from '@plusplusoneplusplus/coc-server';
    ```

- **`packages/coc/src/server/task-comments-handler.ts`** — Change the import block at lines 20–27:
  - Before: `ResolveCommentsPayload` is imported from `@plusplusoneplusplus/pipeline-core` (line 26).
  - After: move `type ResolveCommentsPayload` to a separate coc-server import:
    ```ts
    import {
        DEFAULT_AI_COMMANDS,
        type AICommand,
        buildPromptFromContext,
        type PromptContext,
        type CreateTaskInput,
    } from '@plusplusoneplusplus/pipeline-core';
    import type { ResolveCommentsPayload } from '@plusplusoneplusplus/coc-server';
    ```

- **`packages/coc/test/server/task-generation-queue.test.ts`** — Two import changes:
  1. Lines 37–43: move type guard imports from `@plusplusoneplusplus/pipeline-core` to `@plusplusoneplusplus/coc-server`. Note: `isCodeReviewPayload` is dropped (no longer exists; the test references it but `CodeReviewPayload` is excluded from the new module). Remove lines referencing `isCodeReviewPayload`.
     ```ts
     import {
         isTaskGenerationPayload,
         isFollowPromptPayload,
         isAIClarificationPayload,
         isCustomTaskPayload,
     } from '@plusplusoneplusplus/coc-server';
     ```
  2. Lines 44–51: move type imports from `@plusplusoneplusplus/pipeline-core` to `@plusplusoneplusplus/coc-server`. Drop `CodeReviewPayload`. Keep `QueuedTask` on pipeline-core.
     ```ts
     import type {
         TaskGenerationPayload,
         FollowPromptPayload,
         AIClarificationPayload,
         CustomTaskPayload,
     } from '@plusplusoneplusplus/coc-server';
     import type { QueuedTask } from '@plusplusoneplusplus/pipeline-core';
     ```
  3. Remove or update all test cases that reference `CodeReviewPayload` or `isCodeReviewPayload` (lines 41, 48, 150–155). Either delete those test cases or replace with a different negative-case payload.

### Files to Delete

- (none)

## Implementation Notes

- **`CodeReviewPayload` is dropped entirely**: it was unused in coc-server/coc. The `'code-review'` string stays in the `TaskType` union for forward-compatibility, but no payload interface or guard is defined. Test cases in `task-generation-queue.test.ts` that reference `CodeReviewPayload`/`isCodeReviewPayload` must be removed or replaced.
- **Guard function signatures change**: the `payload` parameter type changes from `TaskPayload` (the old 7-member union) to the new 6-member `TaskPayload` union. Since `CodeReviewPayload` is removed from the union, the guards remain correct without change.
- **`isAIClarificationPayload` relies on exclusion**: it returns true when `'prompt' in payload && !('data' in payload)`. With `CodeReviewPayload` removed, this remains unambiguous across the 6-member union.
- **Two payloads use `readonly kind` discriminants**: `TaskGenerationPayload` (`'task-generation'`) and `RunPipelinePayload` (`'run-pipeline'`). These must be preserved exactly as-is.
- **Existing coc-server import in queue-executor-bridge.ts** (line 51: `import { saveImagesToTempFiles, cleanupTempDir } from '@plusplusoneplusplus/coc-server'`) should be extended rather than creating a duplicate import.

## Tests

- `packages/coc/test/server/task-generation-queue.test.ts` — Update imports and remove `CodeReviewPayload`/`isCodeReviewPayload` references. All existing type guard tests (`isTaskGenerationPayload` positive/negative cases) must still pass. The negative case for `CodeReviewPayload` (lines 150–155) is removed.
- Run `npm run test:run` in `packages/coc/` to verify no regressions.
- Run `npm run build` at repo root to verify all packages compile cleanly.

## Acceptance Criteria

- [ ] `packages/coc-server/src/task-types.ts` exists with `TaskType`, 6 payload interfaces, `TaskPayload`, and 6 type guards
- [ ] `packages/coc-server/src/index.ts` re-exports all symbols from `task-types.ts`
- [ ] No file in `packages/coc/src/` imports any payload type or guard from `@plusplusoneplusplus/pipeline-core`
- [ ] No file in `packages/pipeline-core/src/` exports `TaskType`, any payload interface, `TaskPayload`, or any `is*Payload` guard
- [ ] `npm run build` succeeds at repo root
- [ ] `npm run test:run` passes in `packages/coc/`
- [ ] `npm run test:run` passes in `packages/coc-server/`
- [ ] No references to `CodeReviewPayload` or `isCodeReviewPayload` remain in `packages/coc/`

## Dependencies

- Depends on: 001 (Generify pipeline-core Queue Types)

## Assumed Prior State

After commit 001:
- `QueuedTask.type` is `string` (not `TaskType`)
- `QueuedTask.payload` is `unknown` (not `TaskPayload`)
- `TaskType`, all 7 payload interfaces, `TaskPayload`, and all 7 `is*Payload` guards are **removed** from `packages/pipeline-core/src/queue/types.ts`
- pipeline-core's barrel exports (`packages/pipeline-core/src/index.ts`) no longer include any of these symbols
- All downstream code that referenced these types from pipeline-core now has compile errors (this commit fixes the coc/coc-server side)
