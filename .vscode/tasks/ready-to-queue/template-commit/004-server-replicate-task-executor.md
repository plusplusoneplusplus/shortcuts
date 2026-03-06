---
status: pending
commit: "004"
title: "coc server: add replicate task type to queue executor"
depends_on: ["001", "002"]
---

# Commit 004 — coc server: add replicate-template task type to queue executor

## Summary

Add `replicate-template` as a new task type in the queue executor dispatch chain, and create an "apply" endpoint that writes the AI-generated file changes to disk. The executor calls `replicateCommit()` from pipeline-core's templates module, streams progress via SSE, and stores the `ReplicateResult` on the process. The apply endpoint reads that result and materializes the file changes.

## Prior State (from commits 001 & 002)

- `packages/pipeline-core/src/templates/` exists with:
  - `replicate-service.ts` — `ReplicateService` class with `replicateCommit()` method
  - `types.ts` — `ReplicateOptions`, `FileChange`, `ReplicateResult`
  - `prompt-builder.ts` — `buildReplicatePrompt`
  - `result-parser.ts` — `parseReplicateResponse`
- All symbols are exported from `@plusplusoneplusplus/pipeline-core` (barrel) and `@plusplusoneplusplus/pipeline-core/templates` (subpath)
- `queue-executor-bridge.ts` already dispatches several task types via `executeByType()` using payload type guards imported from `@plusplusoneplusplus/coc-server`

## Files to Modify

### 1. `packages/coc-server/src/types.ts` (or equivalent payload types file)

Add the payload interface and type guard alongside the existing payload definitions (e.g., `RunPipelinePayload`, `FollowPromptPayload`). This ensures the guard is importable from `@plusplusoneplusplus/coc-server` — the same pattern every other payload follows.

```typescript
export interface ReplicateTemplatePayload {
    kind: 'replicate-template';
    templateName: string;
    commitHash: string;
    instruction: string;
    hints?: string[];
    model?: string;
    workingDirectory?: string;
}

export function isReplicateTemplatePayload(
    payload: unknown,
): payload is ReplicateTemplatePayload {
    return (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as any).kind === 'replicate-template' &&
        typeof (payload as any).templateName === 'string' &&
        typeof (payload as any).commitHash === 'string' &&
        typeof (payload as any).instruction === 'string'
    );
}
```

**Pattern reference:** Follow the exact style of existing guards (e.g., `isRunPipelinePayload`, `isFollowPromptPayload`). Each guard checks `kind` discriminator + required field types.

Re-export `isReplicateTemplatePayload` and `ReplicateTemplatePayload` from the coc-server barrel (`packages/coc-server/src/index.ts`).

### 2. `packages/coc/src/server/queue-executor-bridge.ts`

#### 2a. Import the new guard and pipeline-core symbols

Add to the existing `@plusplusoneplusplus/coc-server` import:

```typescript
import {
    // ... existing imports ...
    isReplicateTemplatePayload,
    ReplicateTemplatePayload,
} from '@plusplusoneplusplus/coc-server';
```

Add pipeline-core templates import:

```typescript
import {
    ReplicateService,
    ReplicateResult,
    FileChange,
} from '@plusplusoneplusplus/pipeline-core/templates';
```

#### 2b. Add branch in `executeByType()`

Insert before the default fallback at the end of the dispatch chain:

```typescript
// Replicate template
if (isReplicateTemplatePayload(task.payload)) {
    return this.executeReplicateTemplate(task);
}
```

**Placement:** After the `isRunScriptPayload` check, before the final `return { status: 'completed', message: ... }` fallback. This mirrors the sequential guard-then-dispatch pattern used by every other task type.

#### 2c. Implement `executeReplicateTemplate()`

Add the following private method to the `QueueExecutorBridge` class (or `MultiRepoQueueExecutorBridge` — whichever class hosts `executeByType`):

```typescript
private async executeReplicateTemplate(task: QueuedTask): Promise<unknown> {
    const payload = task.payload as unknown as ReplicateTemplatePayload;
    const processId = `queue_${task.id}`;

    // 1. Resolve workspace root
    const workingDirectory = payload.workingDirectory
        ?? (await this.resolveWorkingDirectory(task));
    if (!workingDirectory) {
        throw new Error('Cannot resolve repository root for replicate-template task');
    }

    // 2. Update process with enriched prompt preview
    const preview = `Replicate commit ${payload.commitHash.slice(0, 8)} → "${payload.instruction}"`;
    await this.store.updateProcess(processId, {
        fullPrompt: payload.instruction,
        promptPreview: preview,
    });

    // 3. Create AI invoker (same pattern as executeRunPipeline)
    const aiInvoker = createCLIAIInvoker({
        model: payload.model ?? task.config?.model,
        approvePermissions: this.approvePermissions,
        workingDirectory,
    });

    // 4. Build progress callback → SSE events
    const onProgress = (event: {
        phase: string;
        message?: string;
        percentage?: number;
    }): void => {
        this.store.emitProcessEvent(processId, {
            type: 'pipeline-progress',
            pipelineProgress: {
                phase: event.phase,       // 'analyzing' | 'generating' | 'parsing' | 'complete'
                totalItems: 1,
                completedItems: event.percentage != null
                    ? Math.round(event.percentage / 100)
                    : 0,
                failedItems: 0,
                percentage: event.percentage ?? 0,
                message: event.message,
            },
        });
    };

    // 5. Emit phase-start event
    this.store.emitProcessEvent(processId, {
        type: 'pipeline-phase',
        pipelinePhase: { phase: 'replicate', status: 'running' },
    });

    // 6. Instantiate service and execute
    const service = new ReplicateService();
    let result: ReplicateResult;
    try {
        result = await service.replicateCommit({
            repoRoot: workingDirectory,
            commitHash: payload.commitHash,
            instruction: payload.instruction,
            hints: payload.hints,
            templateName: payload.templateName,
            aiInvoker,
            onProgress,
        });
    } catch (err) {
        // Emit failure phase event before re-throwing
        this.store.emitProcessEvent(processId, {
            type: 'pipeline-phase',
            pipelinePhase: { phase: 'replicate', status: 'failed' },
        });
        throw err;
    }

    // 7. Emit phase-complete event
    this.store.emitProcessEvent(processId, {
        type: 'pipeline-phase',
        pipelinePhase: { phase: 'replicate', status: 'completed' },
    });

    // 8. Store structured result (FileChange[] + summary) for the apply endpoint
    //    The result is serialized to JSON in the process record so the apply
    //    handler can retrieve it later.
    return {
        response: result.summary,
        replicateResult: {
            summary: result.summary,
            changes: result.changes,    // FileChange[]
            commitHash: payload.commitHash,
            templateName: payload.templateName,
        },
    };
}
```

**Key design decisions:**

- **`onProgress` shape:** Reuses the existing `pipeline-progress` SSE event type so the SPA dashboard progress bar works without changes. The `phase` string inside `pipelineProgress` indicates the replicate sub-phase (`analyzing`, `generating`, `parsing`, `complete`).
- **Result storage:** The `replicateResult` object is stored as part of the process `result` field (serialized via `JSON.stringify` in the completion handler at line ~394). The apply endpoint extracts `replicateResult.changes` from this.
- **Error propagation:** If `replicateCommit()` throws, the existing `catch` block in the task runner sets the process status to `'failed'` and stores the error message. The phase-failure event gives the client immediate SSE feedback before the completion event.

#### 2d. Add `'replicate-template'` to `SHARED_TASK_TYPES`

```typescript
const SHARED_TASK_TYPES: ReadonlySet<string> = new Set([
    'task-generation',
    'ai-clarification',
    'code-review',
    'resolve-comments',
    'update-document',
    'replicate-template',   // ← read-only analysis, no exclusive lock needed
]);
```

**Rationale:** Replicate is a read-only analysis task — it computes file changes but does not write them to disk. Multiple replicate tasks can run concurrently. The separate apply endpoint performs the actual write.

## Files to Create

### 3. `packages/coc/src/server/replicate-apply-handler.ts`

New route handler following the exact `registerXxxRoutes(routes, store)` pattern used throughout the server.

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { Route } from '@plusplusoneplusplus/coc-server';
import type { ProcessStore } from '@plusplusoneplusplus/coc-server';
import { sendJSON, sendError, resolveWorkspace } from './handler-utils';

interface FileChange {
    path: string;
    type: 'new' | 'modified' | 'deleted';
    content?: string;
}

interface ApplyResult {
    applied: string[];
    errors: Array<{ path: string; error: string }>;
}

/**
 * POST /api/workspaces/:id/replicate/:processId/apply
 *
 * Reads the completed ReplicateResult from a process and writes the
 * file changes to disk. Idempotent — re-applying the same result
 * overwrites files with the same content.
 */
export function registerReplicateApplyRoutes(
    routes: Route[],
    store: ProcessStore,
): void {
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/replicate\/([^/]+)\/apply$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const processId = decodeURIComponent(match![2]);

            // 1. Resolve workspace to get repo root
            const ws = await resolveWorkspace(store, workspaceId);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }
            const repoRoot = ws.rootPath;

            // 2. Load the completed process
            const processRecord = await store.getProcess(processId);
            if (!processRecord) {
                return sendError(res, 404, 'Process not found');
            }

            if (processRecord.status !== 'completed') {
                return sendError(
                    res,
                    409,
                    `Process is not completed (status: ${processRecord.status})`,
                );
            }

            // 3. Extract FileChange[] from the process result
            let changes: FileChange[];
            try {
                const result =
                    typeof processRecord.result === 'string'
                        ? JSON.parse(processRecord.result)
                        : processRecord.result;

                changes = result?.replicateResult?.changes;
                if (!Array.isArray(changes) || changes.length === 0) {
                    return sendError(
                        res,
                        422,
                        'Process result does not contain replicate file changes',
                    );
                }
            } catch {
                return sendError(res, 422, 'Failed to parse process result');
            }

            // 4. Validate all paths are within repo root (path traversal guard)
            for (const change of changes) {
                const resolved = path.resolve(repoRoot, change.path);
                if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
                    return sendError(
                        res,
                        403,
                        `Path traversal denied: ${change.path}`,
                    );
                }
            }

            // 5. Apply changes
            const applied: string[] = [];
            const errors: Array<{ path: string; error: string }> = [];

            for (const change of changes) {
                const fullPath = path.resolve(repoRoot, change.path);
                try {
                    switch (change.type) {
                        case 'new':
                        case 'modified': {
                            // Create parent directories as needed
                            await fs.promises.mkdir(path.dirname(fullPath), {
                                recursive: true,
                            });
                            await fs.promises.writeFile(
                                fullPath,
                                change.content ?? '',
                                'utf-8',
                            );
                            applied.push(change.path);
                            break;
                        }
                        case 'deleted': {
                            try {
                                await fs.promises.unlink(fullPath);
                            } catch (err: any) {
                                // Treat ENOENT as success — file already gone
                                if (err.code !== 'ENOENT') {
                                    throw err;
                                }
                            }
                            applied.push(change.path);
                            break;
                        }
                        default:
                            errors.push({
                                path: change.path,
                                error: `Unknown change type: ${(change as any).type}`,
                            });
                    }
                } catch (err: any) {
                    errors.push({
                        path: change.path,
                        error: err.message || String(err),
                    });
                }
            }

            // 6. Return summary
            const status = errors.length === 0 ? 200 : 207; // 207 Multi-Status if partial
            sendJSON(res, status, {
                applied,
                errors,
                total: changes.length,
            } satisfies ApplyResult & { total: number });
        },
    });
}
```

**Error handling matrix:**

| Condition | Status | Message |
|-----------|--------|---------|
| Workspace not found | 404 | `Workspace not found` |
| Process not found | 404 | `Process not found` |
| Process not completed | 409 | `Process is not completed (status: ...)` |
| No changes in result | 422 | `Process result does not contain replicate file changes` |
| Malformed result JSON | 422 | `Failed to parse process result` |
| Path traversal attempt | 403 | `Path traversal denied: <path>` |
| All files applied | 200 | `{ applied: [...], errors: [], total: N }` |
| Partial failure | 207 | `{ applied: [...], errors: [...], total: N }` |
| Individual file error | — | Collected in `errors[]`, does not abort remaining files |

### 4. Route Registration in `packages/coc/src/server/index.ts`

Import and call the new registration function in the server bootstrap, alongside existing route registrations:

```typescript
import { registerReplicateApplyRoutes } from './replicate-apply-handler';

// Inside the route setup block (after other registerXxxRoutes calls):
registerReplicateApplyRoutes(routes, store);
```

**Placement:** After `registerPipelineWriteRoutes(...)` — following the existing grouped ordering of route registrations.

## SSE Event Flow (executor → client)

The replicate executor emits SSE events that the dashboard consumes via its existing EventSource subscription. Here is the full event sequence for a successful replicate task:

```
1. Client enqueues task via POST /api/workspaces/:id/queue
   → payload: { kind: 'replicate-template', templateName, commitHash, instruction, hints? }
   → server creates ghost AIProcess, returns { processId }

2. Client opens EventSource: GET /api/processes/:processId/events
   → SSE stream established

3. Executor picks up task from queue
   → emits: { type: 'pipeline-phase', pipelinePhase: { phase: 'replicate', status: 'running' } }

4. ReplicateService.replicateCommit() runs, calling onProgress periodically:
   → emits: { type: 'pipeline-progress', pipelineProgress: { phase: 'analyzing',  percentage: 10, message: 'Reading commit diff...' } }
   → emits: { type: 'pipeline-progress', pipelineProgress: { phase: 'generating', percentage: 50, message: 'Generating changes...' } }
   → emits: { type: 'pipeline-progress', pipelineProgress: { phase: 'parsing',    percentage: 80, message: 'Parsing AI response...' } }

5. On success:
   → emits: { type: 'pipeline-phase', pipelinePhase: { phase: 'replicate', status: 'completed' } }
   → store.updateProcess(processId, { status: 'completed', result: JSON.stringify({ response, replicateResult }) })
   → emits: { type: 'complete', status: 'completed', duration: '1234ms' }

   On failure:
   → emits: { type: 'pipeline-phase', pipelinePhase: { phase: 'replicate', status: 'failed' } }
   → store.updateProcess(processId, { status: 'failed', error: '...' })
   → emits: { type: 'complete', status: 'failed', duration: '567ms' }

6. Client calls POST /api/workspaces/:id/replicate/:processId/apply
   → server reads result.replicateResult.changes, writes files to disk
   → returns { applied: [...], errors: [...], total: N }
```

The existing SSE handler in `packages/coc-server` (`onProcessOutput`, `onProcessEvent`, `onProcessComplete` subscriptions) picks up all events automatically — no SSE handler changes needed.

## Implementation Steps

1. Add `ReplicateTemplatePayload` interface and `isReplicateTemplatePayload` guard to coc-server's payload types file.
2. Re-export both from `packages/coc-server/src/index.ts`.
3. In `queue-executor-bridge.ts`:
   a. Add imports for the new guard, `ReplicateService`, and `ReplicateResult`.
   b. Add the `isReplicateTemplatePayload` branch in `executeByType()`.
   c. Implement `executeReplicateTemplate()` method.
   d. Add `'replicate-template'` to `SHARED_TASK_TYPES`.
4. Create `packages/coc/src/server/replicate-apply-handler.ts` with `registerReplicateApplyRoutes`.
5. Register the new routes in `packages/coc/src/server/index.ts`.
6. Build and verify: `npm run build`.
7. Run tests: `cd packages/coc && npm run test:run` and `cd packages/coc-server && npm run test:run`.

## Acceptance Criteria

1. **Build succeeds:** `npm run build` exits with code 0. No TypeScript errors in `packages/coc` or `packages/coc-server`.
2. **Type guard works:** `isReplicateTemplatePayload({ kind: 'replicate-template', templateName: 'x', commitHash: 'abc', instruction: 'do stuff' })` returns `true`. Missing/wrong fields return `false`.
3. **Dispatch works:** A queued task with `kind: 'replicate-template'` payload reaches `executeReplicateTemplate()` (not the default no-op fallback).
4. **SSE events flow:** During execution, clients on the process SSE stream receive `pipeline-phase` and `pipeline-progress` events.
5. **Result stored:** The completed process record contains `result.replicateResult.changes` as a `FileChange[]`.
6. **Apply endpoint — success:** `POST /api/workspaces/:id/replicate/:processId/apply` on a completed process writes files and returns 200 with `{ applied, errors: [], total }`.
7. **Apply endpoint — partial failure:** If one file write fails, remaining files are still attempted. Returns 207 with both `applied` and `errors` populated.
8. **Apply endpoint — guards:** Returns 404 for missing workspace/process, 409 for non-completed process, 422 for missing changes, 403 for path traversal.
9. **Concurrency:** `replicate-template` is in `SHARED_TASK_TYPES` — two replicate tasks can run in parallel.
10. **No regressions:** All existing tests pass. No existing exports, types, or routes are modified.

## Commit Message

```
feat(coc): add replicate-template task type to queue executor

- Add ReplicateTemplatePayload interface and type guard in coc-server
- Add executeReplicateTemplate() to queue executor bridge
- Stream progress via existing pipeline-progress SSE events
- Add POST /api/workspaces/:id/replicate/:processId/apply endpoint
- Add replicate-template to SHARED_TASK_TYPES for concurrent execution

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Risks & Notes

- **Depends on commits 001 + 002:** The `ReplicateService` and its types must exist and be exported from pipeline-core before this commit can build. Ensure both prior commits are applied first.
- **`resolveWorkingDirectory` availability:** The method name used to resolve the workspace root from the task may vary depending on the bridge class. Verify the exact method name in the class — it may be `this.resolveWorkingDirectory(task)` or extracted from `task.config.workingDirectory` / `task.payload.workingDirectory`. Adapt accordingly.
- **`handler-utils` imports:** The helper functions `sendJSON`, `sendError`, `resolveWorkspace` may live in a different import path (e.g., directly from `@plusplusoneplusplus/coc-server`). Check the pattern in adjacent handler files and adjust the import.
- **`satisfies` keyword:** Requires TypeScript 4.9+. The project already uses TS 5.x so this is safe.
- **Idempotent apply:** The apply endpoint can be called multiple times safely — `writeFile` overwrites, and `unlink` on a missing file is treated as success (ENOENT ignored).
- **No rollback:** The apply endpoint does not create a backup or support undo. If rollback is needed later, it should be a separate feature (e.g., `git checkout -- .` or a dedicated revert endpoint).
