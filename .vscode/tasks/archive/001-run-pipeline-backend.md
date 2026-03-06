---
status: pending
---

# 001: Add `run-pipeline` Task Type and Server Endpoint

## Summary

Add a new `run-pipeline` task type to the queue system so the dashboard can trigger pipeline executions via REST API. This includes the payload type, type guard, queue validation, executor logic (parsing YAML + calling `executePipeline()`), and a `POST /api/workspaces/:id/pipelines/:name/run` endpoint.

## Motivation

This is the foundational backend commit for the "run pipeline from dashboard" feature. The UI (commit 2+) needs a REST endpoint to trigger pipeline execution and a task type the queue can process. By landing the backend first, we establish the contract (payload shape, route URL, response format) that the UI will consume.

## Changes

### Files to Create

_(none)_

### Files to Modify

#### 1. `packages/pipeline-core/src/queue/types.ts` — Add `RunPipelinePayload` + type guard + union member

**What:**
- Add a new `RunPipelinePayload` interface (after `TaskGenerationPayload`, around line 153)
- Add `'run-pipeline'` to the `TaskType` union (line 17–23)
- Add `RunPipelinePayload` to the `TaskPayload` union (line 168–174)
- Add `isRunPipelinePayload()` type guard (after `isTaskGenerationPayload`, around line 567)

**`RunPipelinePayload` shape:**
```typescript
export interface RunPipelinePayload {
    /** Discriminant field for clean type narrowing */
    readonly kind: 'run-pipeline';
    /** Absolute path to the pipeline package directory (contains pipeline.yaml) */
    pipelinePath: string;
    /** Working directory for AI session execution */
    workingDirectory: string;
    /** Optional AI model override */
    model?: string;
    /** Optional pipeline parameter overrides (key=value) */
    params?: Record<string, string>;
    /** Workspace ID for display / process metadata */
    workspaceId?: string;
}
```

**Type guard:**
```typescript
export function isRunPipelinePayload(payload: TaskPayload): payload is RunPipelinePayload {
    return (payload as any).kind === 'run-pipeline';
}
```

**Pattern reference:** Follows `TaskGenerationPayload` (line 134–153) which uses a `readonly kind` discriminant and `isTaskGenerationPayload` (line 566–568) which checks `(payload as any).kind`.

**`TaskType` union update (line 17–23):**
Add `| 'run-pipeline'` to the union.

**`TaskPayload` union update (line 168–174):**
Add `| RunPipelinePayload` to the union.

#### 2. `packages/coc/src/server/queue-handler.ts` — Add `'run-pipeline'` to validation

**What:**
- Add `'run-pipeline'` to `VALID_TASK_TYPES` set (line 27)
- Add `'run-pipeline': 'Run Pipeline'` to `TYPE_LABELS` map (line 30–37)
- Add a display-name branch in `generateDisplayName()` for the `run-pipeline` type (around line 43–75) — extract pipeline name from `payload.pipelinePath` basename

**Details:**

Line 27 currently:
```typescript
const VALID_TASK_TYPES: Set<string> = new Set(['follow-prompt', 'resolve-comments', 'code-review', 'ai-clarification', 'custom', 'chat']);
```
Change to:
```typescript
const VALID_TASK_TYPES: Set<string> = new Set(['follow-prompt', 'resolve-comments', 'code-review', 'ai-clarification', 'custom', 'chat', 'run-pipeline']);
```

Line 30–37, add entry:
```typescript
'run-pipeline': 'Run Pipeline',
```

In `generateDisplayName()` (line 43–75), add a branch before the fallback:
```typescript
// Run pipeline: use pipeline path basename
if (typeof payload.pipelinePath === 'string' && payload.pipelinePath.trim()) {
    const basename = path.basename(payload.pipelinePath);
    return `${typeLabel}: ${basename}`;
}
```
Note: `path` is already imported at line 19.

#### 3. `packages/coc/src/server/queue-executor-bridge.ts` — Add pipeline execution branch

**What:**
- Import `isRunPipelinePayload`, `parsePipelineYAMLSync`, `executePipeline` from `@plusplusoneplusplus/pipeline-core` (extend existing import on lines 28–43)
- Import `createCLIAIInvoker` from `../ai-invoker` (new import)
- Add a branch in `executeByType()` (line 528–545) for `isRunPipelinePayload`
- Add a private `executePipeline()` method on `CLITaskExecutor`
- Update `extractPrompt()` to handle `RunPipelinePayload`
- Update `getWorkingDirectory()` to handle `RunPipelinePayload`

**`executeByType()` addition (insert before the no-op fallback at line 543–544):**
```typescript
// Run pipeline: parse YAML and execute via pipeline-core
if (isRunPipelinePayload(task.payload)) {
    return this.executeRunPipeline(task);
}
```

**New private method `executeRunPipeline()`:**
```typescript
private async executeRunPipeline(task: QueuedTask): Promise<unknown> {
    const payload = task.payload as RunPipelinePayload;
    const yamlPath = path.join(payload.pipelinePath, 'pipeline.yaml');

    // Read and parse pipeline YAML
    const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
    const config = parsePipelineYAMLSync(yamlContent);

    // Apply model override from payload
    if (payload.model) {
        if (config.map) { config.map.model = payload.model; }
        if (config.job) { config.job.model = payload.model; }
    }

    // Apply parameter overrides
    if (payload.params && Object.keys(payload.params).length > 0) {
        const isJob = !!config.job;
        if (isJob) {
            if (!config.parameters) { config.parameters = []; }
            for (const [key, value] of Object.entries(payload.params)) {
                const existing = config.parameters.find(p => p.name === key);
                if (existing) { existing.value = value; }
                else { config.parameters.push({ name: key, value }); }
            }
        } else if (config.input) {
            if (!config.input.parameters) { config.input.parameters = []; }
            for (const [key, value] of Object.entries(payload.params)) {
                const existing = config.input.parameters!.find(p => p.name === key);
                if (existing) { existing.value = value; }
                else { config.input.parameters!.push({ name: key, value }); }
            }
        }
    }

    // Create AIInvoker using the same factory as `coc run`
    const aiInvoker = createCLIAIInvoker({
        model: payload.model || config.job?.model || config.map?.model,
        approvePermissions: this.approvePermissions,
        workingDirectory: payload.workingDirectory,
    });

    // Execute
    const result = await executePipeline(config, {
        aiInvoker,
        pipelineDirectory: payload.pipelinePath,
        workspaceRoot: payload.workingDirectory,
    });

    return {
        response: result.output?.formattedOutput ?? JSON.stringify(result.executionStats),
        pipelineName: config.name,
        stats: result.executionStats,
    };
}
```

**Pattern reference:** The parameter override logic mirrors `packages/coc/src/commands/run.ts` lines 131–159. The `createCLIAIInvoker` call mirrors `packages/coc/src/commands/run.ts` lines 197–206.

**`extractPrompt()` update (around line 447):** Add at the top of the method:
```typescript
if (isRunPipelinePayload(task.payload)) {
    return `Run pipeline: ${path.basename(task.payload.pipelinePath)}`;
}
```

**`getWorkingDirectory()` update (around line 663):** Add a branch:
```typescript
if (isRunPipelinePayload(task.payload)) {
    return task.payload.workingDirectory || this.defaultWorkingDirectory;
}
```

**Import updates:** Add to the existing pipeline-core import block (lines 28–43):
```typescript
import {
    // ... existing imports ...
    isRunPipelinePayload,
    parsePipelineYAMLSync,
    executePipeline,
} from '@plusplusoneplusplus/pipeline-core';
```
Add `RunPipelinePayload` to the `type` import on line 44.

Add new import:
```typescript
import { createCLIAIInvoker } from '../ai-invoker';
```

#### 4. `packages/coc/src/server/pipelines-handler.ts` — Add `POST .../run` route

**What:** Add a `POST /api/workspaces/:id/pipelines/:name/run` route in `registerPipelineWriteRoutes()` (line 369–641). This route validates the pipeline exists, constructs a `RunPipelinePayload`, enqueues via the multi-repo bridge, and returns 201.

**Signature change:** `registerPipelineWriteRoutes()` needs access to the multi-repo bridge to enqueue tasks. Add a parameter:
```typescript
export function registerPipelineWriteRoutes(
    routes: Route[],
    store: ProcessStore,
    onPipelinesChanged?: (workspaceId: string) => void,
    bridge?: MultiRepoQueueExecutorBridge,  // NEW
): void {
```

**New route (insert before the closing `}` of `registerPipelineWriteRoutes`, after the POST create route ending at line 641):**
```typescript
// ------------------------------------------------------------------
// POST /api/workspaces/:id/pipelines/:name/run — Run a pipeline
// ------------------------------------------------------------------
routes.push({
    method: 'POST',
    pattern: /^\/api\/workspaces\/([^/]+)\/pipelines\/([^/]+)\/run$/,
    handler: async (req, res, match) => {
        if (!bridge) {
            return sendError(res, 503, 'Queue system not available');
        }

        const id = decodeURIComponent(match![1]);
        const pipelineName = decodeURIComponent(match![2]);
        const ws = await resolveWorkspace(store, id);
        if (!ws) {
            return sendError(res, 404, 'Workspace not found');
        }

        const parsed = url.parse(req.url || '/', true);
        const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
            ? parsed.query.folder
            : DEFAULT_PIPELINES_FOLDER;
        const pipelinesDir = path.resolve(ws.rootPath, folder);

        const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
        if (!resolvedDir) {
            return sendError(res, 403, 'Access denied: invalid pipeline name');
        }

        const yamlPath = path.join(resolvedDir, 'pipeline.yaml');
        try {
            await fs.promises.stat(yamlPath);
        } catch {
            return sendError(res, 404, 'Pipeline not found');
        }

        // Parse optional body for overrides
        let body: any = {};
        try {
            body = await parseBody(req);
        } catch {
            // Empty body is fine — all fields are optional
        }

        const payload: RunPipelinePayload = {
            kind: 'run-pipeline',
            pipelinePath: resolvedDir,
            workingDirectory: ws.rootPath,
            model: body?.model,
            params: body?.params,
            workspaceId: id,
        };

        const taskInput: CreateTaskInput<RunPipelinePayload> = {
            type: 'run-pipeline',
            priority: body?.priority || 'normal',
            payload,
            config: { model: body?.model },
            displayName: `Run Pipeline: ${pipelineName}`,
        };

        bridge.getOrCreateBridge(ws.rootPath);
        const queueManager = bridge.registry.getQueueForRepo(ws.rootPath);
        const taskId = queueManager.enqueue(taskInput);

        sendJSON(res, 201, { taskId, pipelineName, queuedAt: Date.now() });
    },
});
```

**Import updates for pipelines-handler.ts:**
```typescript
import type { CreateTaskInput } from '@plusplusoneplusplus/pipeline-core';
import type { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
import type { RunPipelinePayload } from '@plusplusoneplusplus/pipeline-core';
```
Note: `RunPipelinePayload` is a type-only import. `CreateTaskInput` is already likely importable from pipeline-core but needs to be added to the import.

**Caller update:** The caller of `registerPipelineWriteRoutes()` in `packages/coc/src/server/index.ts` must pass the `bridge` argument. Find the call site and add the bridge parameter.

#### 5. `packages/coc/src/server/index.ts` — Pass bridge to `registerPipelineWriteRoutes`

**What:** Update the call to `registerPipelineWriteRoutes()` to pass the multi-repo bridge so the new `/run` route can enqueue tasks.

**Details:** Find the call to `registerPipelineWriteRoutes(writeRoutes, store, ...)` and add the bridge argument. The bridge variable should already be in scope (it's created for queue routes).

### Files to Delete

_(none)_

## Implementation Notes

1. **Discriminant pattern:** `RunPipelinePayload` uses `readonly kind: 'run-pipeline'` as a discriminant, matching the `TaskGenerationPayload` pattern (line 136 of types.ts). The type guard uses `(payload as any).kind` check, same as `isTaskGenerationPayload` (line 567).

2. **`task-generation` is NOT in `VALID_TASK_TYPES`** because it has its own dedicated handler (`task-generation-handler.ts`) that bypasses the generic queue validation. However, `run-pipeline` SHOULD be added to `VALID_TASK_TYPES` because the `/run` endpoint enqueues via the same `queueManager.enqueue()` path as generic queue tasks, and we want the generic queue list/cancel/stats endpoints to work with pipeline tasks.

3. **`executePipeline()` signature** (from `packages/pipeline-core/src/pipeline/executor.ts:124`):
   ```typescript
   executePipeline(config: PipelineConfig, options: ExecutePipelineOptions): Promise<PipelineExecutionResult>
   ```
   `ExecutePipelineOptions` requires `aiInvoker` and `pipelineDirectory`. Optional: `workspaceRoot`, `processTracker`, `onProgress`, `isCancelled`.

4. **`createCLIAIInvoker()`** (from `packages/coc/src/ai-invoker.ts:83`) wraps `CopilotSDKService` as an `AIInvoker` function. It accepts `CLIAIInvokerOptions` with `model`, `approvePermissions`, `workingDirectory`, `timeoutMs`, `loadMcpConfig`, `onChunk`.

5. **`parsePipelineYAMLSync()`** (from `packages/pipeline-core/src/pipeline/executor.ts:1834`) parses YAML string into `PipelineConfig`. Throws on invalid YAML.

6. **Parameter override logic** in `executeRunPipeline()` mirrors `packages/coc/src/commands/run.ts` lines 116–159 (model override + parameter override for job vs map-reduce pipelines).

7. **The route pattern** `POST /api/workspaces/:id/pipelines/:name/run` follows the existing REST convention in `pipelines-handler.ts` where `:id` is the workspace ID and `:name` is the pipeline package directory name.

8. **The enqueue pattern** mirrors `task-generation-handler.ts` lines 316–328: construct `CreateTaskInput<T>`, call `bridge.getOrCreateBridge(ws.rootPath)` then `bridge.registry.getQueueForRepo(ws.rootPath).enqueue(taskInput)`, and return 201 with `{ taskId, queuedAt }`.

9. **`registerPipelineWriteRoutes` gets an optional `bridge` parameter** (not required) to avoid breaking existing callers and because the route gracefully returns 503 if bridge is absent.

10. **No streaming in this commit.** The `executeRunPipeline()` method does not wire up `onStreamingChunk` or `onProgress` callbacks. Streaming can be added in a follow-up commit. The process will appear as running, then jump to completed/failed.

## Tests

### Unit tests for the new payload type guard (`packages/pipeline-core/test/queue/queue-types.test.ts`)

- **`isRunPipelinePayload` returns `true` for valid payload** — construct a `RunPipelinePayload` with `kind: 'run-pipeline'` and assert the guard returns true.
- **`isRunPipelinePayload` returns `false` for other payloads** — test against `FollowPromptPayload`, `AIClarificationPayload`, `CustomTaskPayload`, `TaskGenerationPayload`.
- **`RunPipelinePayload` accepts all fields** — type-check test constructing a full payload with `pipelinePath`, `workingDirectory`, `model`, `params`, `workspaceId`.
- **`RunPipelinePayload` requires mandatory fields** — type-check that `kind`, `pipelinePath`, `workingDirectory` are required.

### Integration test for `POST /api/workspaces/:id/pipelines/:name/run` (`packages/coc/test/server/pipelines-handler.test.ts`)

- **Returns 201 with taskId when pipeline exists** — create a workspace with a valid pipeline, POST to `/run`, assert 201 response with `taskId` and `pipelineName` in body.
- **Returns 404 when workspace not found** — POST with invalid workspace ID, assert 404.
- **Returns 404 when pipeline not found** — POST with valid workspace but non-existent pipeline name, assert 404.
- **Returns 403 for path traversal** — POST with pipeline name like `../../etc`, assert 403.
- **Accepts optional body with model and params** — POST with `{ model: "gpt-4", params: { key: "value" } }`, assert 201.

### Unit test for executor bridge (`packages/coc/test/server/queue-executor-bridge.test.ts`)

- **`executeByType` handles `run-pipeline` type** — mock `fs.readFileSync` to return valid pipeline YAML, mock `executePipeline` from pipeline-core, enqueue a `run-pipeline` task, verify it reaches completed status.

## Acceptance Criteria

- [ ] `RunPipelinePayload` interface exists in `packages/pipeline-core/src/queue/types.ts` with `kind: 'run-pipeline'`, `pipelinePath`, `workingDirectory`, optional `model`, `params`, `workspaceId`
- [ ] `isRunPipelinePayload()` type guard exists and correctly identifies the payload
- [ ] `'run-pipeline'` is in the `TaskType` union
- [ ] `RunPipelinePayload` is in the `TaskPayload` union
- [ ] `'run-pipeline'` is accepted by `VALID_TASK_TYPES` in `queue-handler.ts`
- [ ] `CLITaskExecutor.executeByType()` dispatches to `executeRunPipeline()` for `run-pipeline` tasks
- [ ] `executeRunPipeline()` reads pipeline YAML, creates AIInvoker via `createCLIAIInvoker()`, and calls `executePipeline()` from pipeline-core
- [ ] `POST /api/workspaces/:id/pipelines/:name/run` returns 201 with `{ taskId, pipelineName, queuedAt }` for valid pipelines
- [ ] Route returns 404 for missing workspace or pipeline, 403 for path traversal
- [ ] All existing tests pass (no regressions)
- [ ] New unit tests for `isRunPipelinePayload` pass
- [ ] New integration test for the `/run` endpoint passes

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit. All modified files exist in their current form as read during plan creation.
