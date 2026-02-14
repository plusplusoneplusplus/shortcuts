# Pipeline Queue Integration Plan

## Problem Statement

Pipeline execution currently bypasses the existing AIQueueService. When a user clicks "Execute" on a pipeline, it runs immediately via `executeVSCodePipeline()` with a VSCode progress notification. Multiple pipelines can run simultaneously without coordination, competing for AI resources (session pool, SDK connections).

**Goal:** Route pipeline execution through the existing `AIQueueService` so all AI work (pipelines, clarifications, follow-prompts, code reviews) shares a single queue with unified concurrency control.

## Proposed Approach

Add a `'pipeline-execution'` task type to the queue system. When queue is enabled, `PipelineCommands.executePipeline()` will enqueue the pipeline instead of executing immediately. The existing `AITaskExecutor` will handle execution when the task is dequeued. The VSCode progress notification will appear only when execution actually starts (not while queued). FIFO ordering only (no priority for pipelines).

### Key Design Decisions

1. **Graceful fallback**: When the queue is disabled (`workspaceShortcuts.queue.enabled = false`), pipeline execution behaves exactly as today (immediate execution).
2. **Queue status bar** shows position while queued; VSCode progress notification appears when execution starts.
3. **Cancellation**: Users can cancel a queued pipeline before it starts, or cancel during execution via the progress notification.
4. **Process tracking**: The existing `AIProcessManager` tracks the pipeline — registered as "queued" initially, then transitions to "running" when execution begins.

## Files to Modify

### pipeline-core (types)
- `packages/pipeline-core/src/queue/types.ts` — Add `'pipeline-execution'` to `TaskType` union, add `PipelineExecutionPayload` interface, add type guard

### pipeline-core (exports)
- `packages/pipeline-core/src/queue/index.ts` — Export new payload type and type guard

### AI Queue Service (executor)
- `src/shortcuts/ai-service/ai-queue-service.ts` — Add pipeline execution handler in `AITaskExecutor.execute()`, add new method `executePipelineTask()`

### Pipeline Commands (entry point)
- `src/shortcuts/yaml-pipeline/ui/commands.ts` — Modify `executePipeline()` and `executePipelineWithItems()` to check queue and enqueue when enabled

### Tests
- `src/test/suite/ai-queue-service.test.ts` — Add tests for pipeline task queueing
- `packages/pipeline-core/test/queue/` — Add tests for new type and type guard

## Todos

1. **add-pipeline-task-type** — Add `'pipeline-execution'` to `TaskType`, create `PipelineExecutionPayload`, add `isPipelineExecutionPayload` type guard in `packages/pipeline-core/src/queue/types.ts`, export from `index.ts`

2. **add-pipeline-executor-handler** — In `AITaskExecutor.execute()` in `ai-queue-service.ts`, add handler for `isPipelineExecutionPayload` that calls `executeVSCodePipeline()`, bridging the queue system to the existing pipeline executor. Import necessary types.

3. **modify-pipeline-commands** — In `commands.ts`, modify `executePipeline()` to check `getAIQueueService()?.isEnabled()`. If enabled, enqueue the pipeline as a `'pipeline-execution'` task. If disabled, execute immediately (current behavior). Same for `executePipelineWithItems()`.

4. **handle-progress-notification** — When the queued pipeline task starts execution, show the VSCode progress notification. The `AITaskExecutor` pipeline handler should call `executeVSCodePipeline()` which already wraps with `vscode.window.withProgress()`.

5. **add-tests** — Write unit tests for: new payload type guard, pipeline task queueing in AIQueueService, and fallback to immediate execution when queue is disabled.

## Notes

- The `AITaskExecutor` currently handles `FollowPromptPayload` and `AIClarificationPayload`. Adding pipeline support follows the same pattern.
- The `executeVSCodePipeline()` function already handles process tracking, progress reporting, and cancellation — the queue integration wraps around it.
- Since we're using FIFO, the existing priority infrastructure is present but pipeline tasks will always use 'normal' priority.
- The queue's `maxConcurrency` setting (default: 1) naturally serializes pipeline execution alongside other AI tasks.
