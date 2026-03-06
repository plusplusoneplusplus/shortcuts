---
status: done
---

# 003: Wire Child Process Creation in Queue Executor Bridge

## Summary
Connect the executor's `onItemProcessCreated` callback to the `ProcessStore` in the queue executor bridge, so that each map item creates a persisted child `AIProcess` record linked to the parent pipeline run.

## Motivation
Commit 2 added the callback in the executor but left persistence to the caller. The queue executor bridge is that caller — it's where `executePipeline` is invoked for `coc serve`. This commit wires the callback to `store.addProcess()`, creating real persisted child records that the API and SPA can query.

## Changes

### Files to Modify
- `packages/coc/src/server/queue-executor-bridge.ts`:
  - In `executeRunPipeline` (line 1097), add `onItemProcessCreated` to the `executePipeline` options object
  - The callback should:
    1. Create an `AIProcess` with `id: event.processId`, `type: 'pipeline-item'`, `parentProcessId: parentProcessId` (the pipeline run's process ID), `status` based on item result, `metadata` including item input/output
    2. Call `store.addProcess(childProcess)`
    3. Emit `store.emitProcessEvent(parentProcessId, { type: 'item-process', ... })` for SSE
  - After pipeline completion, update the parent process: `store.updateProcess(parentProcessId, { groupMetadata: { childProcessIds: result.itemProcessIds } })`

## Implementation Notes

### Exact insertion point

The `executeRunPipeline` method is at **line 1097** of `queue-executor-bridge.ts`. The `executePipeline` call starts at **line 1141** with an options object spanning lines 1141–1175:

```typescript
// line 1140
const processId = `queue_${task.id}`;
const result = await executePipeline(config, {
    aiInvoker,
    pipelineDirectory: payload.pipelinePath,
    workspaceRoot: payload.workingDirectory,
    onPhaseChange: (event) => {       // line 1145 — existing callback
        try {
            this.store.emitProcessEvent(processId, {
                type: 'pipeline-phase',
                pipelinePhase: event,
            });
        } catch {
            // Non-fatal: store may be a stub
        }
    },
    onProgress: (progress) => {        // line 1155 — existing callback
        try {
            this.store.emitProcessEvent(processId, {
                type: 'pipeline-progress',
                pipelineProgress: { ... },
            });
        } catch {
            // Non-fatal
        }
    },
});                                    // line 1175
```

Insert `onItemProcessCreated` as a **third callback** inside the options object, after the `onProgress` block (before the closing `});` on line 1175). Follow the identical try/catch + `// Non-fatal` pattern used by `onPhaseChange` and `onProgress`.

### Callback implementation pattern

```typescript
onItemProcessCreated: (event) => {
    // Fire-and-forget — don't await, don't block the pipeline
    const childProcess: AIProcess = {
        id: event.processId,
        type: 'pipeline-item',
        parentProcessId: processId,      // processId = `queue_${task.id}` from line 1140
        promptPreview: typeof event.item === 'string'
            ? (event.item.length > 80 ? event.item.substring(0, 77) + '...' : event.item)
            : JSON.stringify(event.item).substring(0, 80),
        fullPrompt: typeof event.item === 'string' ? event.item : JSON.stringify(event.item),
        status: 'running',
        startTime: new Date(),
        metadata: {
            type: 'pipeline-item',
            itemIndex: event.itemIndex,
            phase: event.phase,
            parentPipelineId: processId,
        },
    };
    this.store.addProcess(childProcess).catch(() => {
        // Non-fatal: don't fail the pipeline if store write fails
    });
    try {
        this.store.emitProcessEvent(processId, {
            type: 'pipeline-progress',
            pipelineProgress: {
                phase: 'map',
                message: `Item process created: ${event.processId}`,
            },
        });
    } catch {
        // Non-fatal
    }
},
```

### Post-completion parent update

After the `executePipeline` call returns (line 1175), before the existing `return` block at line 1177, add the parent `groupMetadata` update:

```typescript
// Update parent process with child process IDs
if (result.itemProcessIds?.length) {
    this.store.updateProcess(processId, {
        groupMetadata: {
            type: 'pipeline-execution',
            childProcessIds: result.itemProcessIds,
        },
    }).catch(() => {
        // Non-fatal
    });
}
```

This mirrors the pattern at lines 361–373 where the parent is updated with `status: 'completed'` via `store.updateProcess`.

### Key constraints

- **`processId` variable** — Already defined at line 1140 as `` `queue_${task.id}` `` and used throughout the method. This is the parent process ID.
- **`this.store`** — The `ProcessStore` instance (line 123: `private readonly store: ProcessStore`). Methods used: `addProcess` (line 293), `updateProcess` (line 363), `emitProcessEvent` (line 542). All three are already used elsewhere in the class.
- **`ProcessOutputEvent.type`** — Currently supports `'pipeline-phase'` and `'pipeline-progress'` for pipeline events. A new `'item-process'` type would require adding it to the union at `process-store.ts:18`. Alternatively, reuse `'pipeline-progress'` with a distinguishing `message` field to avoid a cross-package type change.
- Child process creation must be async but non-blocking (don't await — use fire-and-forget with error logging via `.catch()`)
- Child AIProcess should have: `promptPreview` from item input, `result` from item output, `conversationTurns` if available from the AI SDK session
- The `sdkSessionId` from `PromptMapResult.sessionId` should be stored on the child process for chat resume capability — this requires a second `store.updateProcess` call after the map item completes (since `onItemProcessCreated` fires at creation time, not completion)
- Error handling: if `store.addProcess` fails, log warning but don't fail the pipeline (consistent with `// Non-fatal: store may be a stub` pattern used at lines 1151, 1171)

### Type considerations

- `AIProcessType` already includes `'pipeline-item'` in its union (`process-types.ts:25`), so no type changes needed for the child process type.
- `GenericGroupMetadata` (`process-types.ts:46-49`) has `childProcessIds: string[]` — the exact shape needed for the parent update.
- `ProcessFilter` will need a `parentProcessId?: string` field to query children (already done in Commit 1).

## Tests
- Test: `executeRunPipeline` with 3-item pipeline → 3 child AIProcess records created in store
- Test: child processes have correct `parentProcessId` pointing to pipeline run
- Test: child processes have `type: 'pipeline-item'`
- Test: parent process gets `groupMetadata.childProcessIds` on completion
- Test: `store.emitProcessEvent` called per child for SSE propagation
- Test: child process creation failure doesn't crash the pipeline

## Acceptance Criteria
- [ ] Each map item creates a persisted child `AIProcess` in the store
- [ ] Child processes linked via `parentProcessId` to the pipeline run
- [ ] Parent process updated with `childProcessIds` on completion
- [ ] SSE event emitted per child process creation
- [ ] Non-blocking — child persistence failures don't fail the pipeline
- [ ] Tests pass on Linux, macOS, Windows

## Dependencies
- Depends on: 001, 002

## Assumed Prior State
- `ProcessFilter.parentProcessId` works (Commit 1)
- `onItemProcessCreated` callback fires per map item (Commit 2)
