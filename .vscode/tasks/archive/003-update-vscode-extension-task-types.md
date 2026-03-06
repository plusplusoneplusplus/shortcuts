---
status: pending
---

# 003: Update VS Code Extension Task Types

## Summary

Create local copies of `FollowPromptPayload`, `AIClarificationPayload`, and their guards in the VS Code extension, then rewire all imports away from `@plusplusoneplusplus/pipeline-core` — avoiding any new dependency on `@plusplusoneplusplus/coc-server`.

## Motivation

The VS Code extension must not depend on `@plusplusoneplusplus/coc-server` (it's a standalone Node.js server package with HTTP/WebSocket concerns). After commits 1–2, pipeline-core no longer exports the domain-specific payload interfaces or guards. The extension only needs two payload types and two guards, so a small local file is the cleanest solution.

## Changes

### Files to Create

- **`src/shortcuts/ai-service/task-types.ts`** — Local payload interfaces and type guards for the AI queue system.

  Contains:

  ```typescript
  export interface FollowPromptPayload {
      repoId?: string;
      promptFilePath?: string;
      promptContent?: string;
      planFilePath?: string;
      skillName?: string;
      additionalContext?: string;
      workingDirectory?: string;
      folderPath?: string;
  }

  export interface AIClarificationPayload {
      repoId?: string;
      prompt?: string;
      workingDirectory?: string;
      model?: string;
      selectedText?: string;
      filePath?: string;
      startLine?: number;
      endLine?: number;
      surroundingLines?: string;
      nearestHeading?: string | null;
      instructionType?: string;
      customInstruction?: string;
      promptFileContent?: string;
      skillName?: string;
  }
  ```

  Guards use `Record<string, unknown>` as the parameter type instead of the old `TaskPayload` union (which no longer exists in pipeline-core after commits 1–2):

  ```typescript
  export function isFollowPromptPayload(payload: Record<string, unknown>): payload is FollowPromptPayload {
      return 'promptFilePath' in payload || 'promptContent' in payload;
  }

  export function isAIClarificationPayload(payload: Record<string, unknown>): payload is AIClarificationPayload {
      return 'prompt' in payload && !('data' in payload);
  }
  ```

### Files to Modify

- **`src/shortcuts/ai-service/ai-queue-service.ts`** — Rewire imports.
  - Remove `isFollowPromptPayload`, `isAIClarificationPayload`, `FollowPromptPayload`, `AIClarificationPayload` from the `@plusplusoneplusplus/pipeline-core` import block (lines 30–33).
  - Remove `TaskPayload` from the same import block (line 22) — it is only used to type the `payload` field in the local `QueueTaskOptions` interface (line 61). After this commit, that field type changes to `Record<string, unknown>` since the `TaskPayload` union no longer exists in pipeline-core.
  - Add a new import: `import { FollowPromptPayload, AIClarificationPayload, isFollowPromptPayload, isAIClarificationPayload } from './task-types';`

  Resulting pipeline-core import (lines 15–34 become):
  ```typescript
  import {
      TaskQueueManager,
      QueueExecutor,
      createTaskQueueManager,
      createQueueExecutor,
      QueuedTask,
      CreateTaskInput,
      TaskPriority,
      QueueStats,
      TaskExecutor,
      TaskExecutionResult,
      QueueChangeEvent,
      getCopilotSDKService,
      approveAllPermissions,
  } from '@plusplusoneplusplus/pipeline-core';
  ```

- **`src/test/suite/follow-prompt-consistency.test.ts`** — Change import source.
  - Line 27: change `import { FollowPromptPayload } from '@plusplusoneplusplus/pipeline-core';`
  - To: `import { FollowPromptPayload } from '../../shortcuts/ai-service/task-types';`

### Files to Delete

- (none)

## Implementation Notes

- **Guard parameter type:** The original guards accept `TaskPayload` (a union of all 7 payload types). Since that union no longer exists in pipeline-core after commit 2 and we don't want to recreate it, use `Record<string, unknown>` instead. This is structurally compatible — the `in` operator works on any object — and the `payload is X` return type still narrows correctly for callers.
- **`QueueTaskOptions.payload` type:** Currently typed as `TaskPayload` (line 61 of `ai-queue-service.ts`). Replace with `Record<string, unknown>` since the union is gone. Callers already pass concrete `FollowPromptPayload` / `AIClarificationPayload` objects which are assignable to `Record<string, unknown>`.
- **JSDoc comments:** Preserve the JSDoc comments from the original interfaces (e.g., `/** Repository identifier (for multi-repo workspaces) */`).
- **No barrel export needed:** The new `task-types.ts` file does not need to be re-exported from `src/shortcuts/ai-service/index.ts` unless something outside the `ai-service` folder imports these types. The test file imports directly from the file path.
- **Structural typing:** TypeScript uses structural typing, so the locally-defined interfaces are fully compatible with any code that previously used the pipeline-core versions — no runtime changes.

## Tests

- **Existing test passes:** `src/test/suite/follow-prompt-consistency.test.ts` compiles and passes with the new import path. This test exercises `FollowPromptPayload` as a type annotation and validates prompt-building behavior.
- **Build verification:** `npm run compile` succeeds with no type errors in the modified files.
- **Full test suite:** `npm run test` passes (no regressions from import rewiring).

## Acceptance Criteria

- [ ] `src/shortcuts/ai-service/task-types.ts` exists with both interfaces and both guards
- [ ] `FollowPromptPayload` and `AIClarificationPayload` field definitions match the originals from pipeline-core exactly (same field names, types, and optionality)
- [ ] Guard logic is identical: `isFollowPromptPayload` checks `'promptFilePath' in payload || 'promptContent' in payload`; `isAIClarificationPayload` checks `'prompt' in payload && !('data' in payload)`
- [ ] `ai-queue-service.ts` no longer imports any payload type or guard from `@plusplusoneplusplus/pipeline-core`
- [ ] `ai-queue-service.ts` imports all four symbols from `./task-types`
- [ ] `TaskPayload` is removed from the pipeline-core import; `QueueTaskOptions.payload` uses `Record<string, unknown>`
- [ ] `follow-prompt-consistency.test.ts` imports `FollowPromptPayload` from `../../shortcuts/ai-service/task-types`
- [ ] `npm run compile` succeeds with zero errors
- [ ] `npm run test` passes

## Dependencies

- Depends on: 001 (pipeline-core `QueuedTask.type` → `string`, payload types removed), 002 (`TaskType` enum, payload interfaces, and guards moved to `@plusplusoneplusplus/coc-server`)

## Assumed Prior State

After commits 1–2:
- `@plusplusoneplusplus/pipeline-core` no longer exports: `TaskType`, `FollowPromptPayload`, `AIClarificationPayload`, `ResolveCommentsPayload`, `CodeReviewPayload`, `TaskGenerationPayload`, `RunPipelinePayload`, `CustomTaskPayload`, `TaskPayload` (the union), or any `is*Payload` guard functions.
- `QueuedTask.type` is `string` (not `TaskType` enum).
- `QueuedTask` generic parameter `TPayload` is `Record<string, unknown>` (not constrained to `TaskPayload`).
- `CreateTaskInput.type` is `string`.
- `@plusplusoneplusplus/coc-server` exports all the removed types and guards, but the VS Code extension does **not** depend on that package.
