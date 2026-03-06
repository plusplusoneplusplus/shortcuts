---
status: done
commit: "004"
title: "Pipeline integration — wire capture into executor"
depends_on: ["001", "002", "003"]
files_create:
  - packages/pipeline-core/src/memory/memory-integration.ts
  - packages/pipeline-core/test/memory/memory-integration.test.ts
files_modify:
  - packages/pipeline-core/src/pipeline/executor.ts
  - packages/pipeline-core/src/index.ts
  - packages/pipeline-core/src/memory/index.ts
---

# 004 — Pipeline integration: wire capture into executor

## Summary

Connect `MemoryStore` and `captureObservations` to the pipeline execution flow. When a pipeline has `memory.capture: true`, wrap the `AIInvoker` to capture observations after AI calls. For map-reduce pipelines, capture once after the reduce phase (not per-item during map).

## Motivation

This is the final wiring commit that makes memory actually work during pipeline execution. Without this, the `MemoryStore` (commit 002) and `captureObservations` (commit 003) exist but are never invoked. After this commit, any pipeline with `memory: true` or `memory: { capture: true }` will automatically capture and persist observations.

## Existing Code — Key Integration Points

### `executePipeline` (executor.ts lines 173–208)

```typescript
export async function executePipeline(
    config: PipelineConfig,
    options: ExecutePipelineOptions
): Promise<PipelineExecutionResult>
```

Flow:
1. `validatePipelineConfig(config)` — line 178
2. If `config.job` → `executeSingleJob(config, options)` — line 182
3. Else (map-reduce): resolve prompts → load input → `executeWithItems(mrConfig, items, prompts, options)` — line 207

This is the top-level entry point. Memory lifecycle should wrap around this entire flow.

### `ExecutePipelineOptions` (executor.ts lines 81–103)

```typescript
export interface ExecutePipelineOptions {
    aiInvoker: AIInvoker;
    pipelineDirectory: string;
    workspaceRoot?: string;
    processTracker?: ProcessTracker;
    onProgress?: (progress: JobProgress) => void;
    onPhaseChange?: (event: PipelinePhaseEvent) => void;
    isCancelled?: () => boolean;
}
```

No memory field here — memory config lives on `PipelineConfig`, not on options.

### `AIInvoker` type (map-reduce/types.ts line 294)

```typescript
export type AIInvoker = (prompt: string, options?: AIInvokerOptions) => Promise<AIInvokerResult>;
```

Where `AIInvokerResult` is `{ success: boolean; response?: string; error?: string; sessionId?: string }`.

### Where `aiInvoker` is called in executor.ts

| Call site | Line | Context |
|-----------|------|---------|
| `executeSingleJob` | 282 | Single job AI call |
| `executeSingleJob` retry | 409 | Retry path |
| `executeFilter` | 745 | AI filter phase |
| `executeStandardMode` | 809, 828 | Passed into `ExecutorOptions` and `createPromptMapJob` |
| `executeBatchMode` | 971, 1022 | Batch prompt calls |
| Reduce phase (AI) | 1467 | `options?.aiInvoker(prompt, { model: reduceModel })` |

### Phase tracking (executor.ts lines 120–148)

`createPhaseTrackingProgress` wraps `onProgress` to detect MR phase transitions:
- `'mapping'` phase start → emits `('map', 'started')`
- `'reducing'` phase start → emits `('map', 'completed')` then `('reduce', 'started')`
- `'complete'` phase → emits `('reduce', 'completed')`

This is relevant because we want to capture after the reduce phase completes, not per-item during map.

### `PipelineConfig` (pipeline/types.ts lines 55–79)

```typescript
export interface PipelineConfig {
    name: string;
    workingDirectory?: string;
    input?: InputConfig;
    filter?: FilterConfig;
    map?: MapConfig;
    reduce?: ReduceConfig;
    job?: JobConfig;
    parameters?: PipelineParameter[];
}
```

Commit 001 adds `memory?: MemoryConfig | boolean` to this interface.

### CLI caller (coc/src/commands/run.ts lines 229–243)

```typescript
const result = await executePipeline(config, {
    aiInvoker,
    pipelineDirectory: pipelineDir,
    workspaceRoot: options.workspaceRoot,
    isCancelled: () => cancelled,
    onProgress: (progress: JobProgress) => { ... },
});
```

The CLI does **not** pass `onPhaseChange`. Memory wiring should happen inside `executePipeline` itself (not in the CLI), so it works from any caller.

### index.ts export pattern

Barrel exports grouped by section with `// === Section ===` comments. Each group uses explicit `export { ... } from './module'`. No wildcard re-exports. Memory section should follow the same pattern, placed after Pipeline Framework (line 613).

## Design

### `memory-integration.ts`

```typescript
import { MemoryConfig } from './types';       // from commit 001
import { MemoryStore } from './memory-store';   // from commit 002
import { captureObservations } from './memory-capture'; // from commit 003
import { AIInvoker, AIInvokerResult } from '../map-reduce/types';

interface MemoryIntegrationOptions {
    config: MemoryConfig;         // already normalized (boolean expanded)
    store: MemoryStore;
    repoPath?: string;
    pipelineName: string;
}

/**
 * Normalize memory config — expand boolean shorthand to full config.
 * Returns null if memory is disabled.
 */
function normalizeMemoryConfig(
    memory: MemoryConfig | boolean | undefined
): MemoryConfig | null;
// - true → { capture: true } (with defaults)
// - false / undefined → null
// - object → return as-is

/**
 * Memory lifecycle for a pipeline run.
 * Wraps an AIInvoker to capture observations, tracks pending captures,
 * and provides flush() to wait for completion.
 */
interface MemoryLifecycle {
    wrappedInvoker: AIInvoker;
    /** Wait for all pending background captures to complete */
    flush(): Promise<void>;
}

/**
 * Create a memory lifecycle that wraps an AIInvoker.
 *
 * The wrappedInvoker:
 * 1. Calls originalInvoker(prompt, opts) as normal
 * 2. On success, fires captureObservations() in background (non-blocking)
 * 3. Returns the original result immediately (don't wait for capture)
 * 4. Capture errors are logged but never propagate to the caller
 */
function createMemoryLifecycle(
    originalInvoker: AIInvoker,
    options: MemoryIntegrationOptions
): MemoryLifecycle;
```

Implementation notes:
- Track pending captures with a `Set<Promise<void>>` (add on start, remove on settle)
- `flush()` → `Promise.allSettled([...pendingCaptures])`
- Capture errors: catch, log via `getLogger()`, never re-throw
- Pass `pipelineName` as context to `captureObservations` for provenance

### Strategy for map-reduce: capture after reduce only

**Chosen approach:** Use a phase-aware flag inside `createMemoryLifecycle`.

Rather than creating separate invokers per phase, the wrapper tracks which phase is active:
- During `'map'` phase → skip capture (would fire per-item, too noisy)
- During `'reduce'` and `'job'` phases → capture observations
- Phase is set via a `setPhase(phase)` method on the lifecycle

Updated interface:

```typescript
interface MemoryLifecycle {
    wrappedInvoker: AIInvoker;
    setPhase(phase: 'map' | 'reduce' | 'job' | 'filter'): void;
    flush(): Promise<void>;
}
```

In `executePipeline`:
- Before `executeSingleJob` → `lifecycle.setPhase('job')`
- Before `executeWithItems` → `lifecycle.setPhase('map')` (implicitly, or default)
- Hook into the existing `createPhaseTrackingProgress` or `onPhaseChange` to toggle to `'reduce'` when the reduce phase starts

Concrete wiring in `executePipeline`:
```typescript
// After validatePipelineConfig(config):
const memConfig = normalizeMemoryConfig(config.memory);
let lifecycle: MemoryLifecycle | undefined;
if (memConfig) {
    const store = new MemoryStore({ baseDir: defaultMemoryBaseDir() });
    lifecycle = createMemoryLifecycle(options.aiInvoker, {
        config: memConfig,
        store,
        pipelineName: config.name,
    });
    // Replace aiInvoker in a shallow copy of options
    options = { ...options, aiInvoker: lifecycle.wrappedInvoker };
}

// For single job mode:
if (config.job) {
    lifecycle?.setPhase('job');
    const result = await executeSingleJob(config, options);
    await lifecycle?.flush();
    return result;
}

// For map-reduce mode:
lifecycle?.setPhase('map');  // skip capture during map
// ... existing code (resolve prompts, load items, etc.) ...
// Wrap onPhaseChange to detect reduce start:
if (lifecycle) {
    const originalOnPhaseChange = options.onPhaseChange;
    options = {
        ...options,
        onPhaseChange: (event) => {
            if (event.phase === 'reduce' && event.status === 'started') {
                lifecycle!.setPhase('reduce');
            }
            originalOnPhaseChange?.(event);
        }
    };
}
const result = await executeWithItems(mrConfig, items, prompts, options);
await lifecycle?.flush();
return result;
```

**Why this approach:**
- Minimal changes to executor.ts — no new parameters, no changes to inner functions
- Uses the existing `onPhaseChange` mechanism (already wired through `createPhaseTrackingProgress`)
- `setPhase` is simple state toggle — no complex refactoring needed

### Export from index.ts

Add after the Pipeline Framework section (after line 613):

```typescript
// ============================================================================
// Memory
// ============================================================================

export {
    // Types (from commit 001)
    MemoryConfig,
    MemoryLevel,
    RawObservation,
    // Store (from commit 002)
    MemoryStore,
    // Capture (from commit 003)
    captureObservations,
    // Integration (this commit)
    normalizeMemoryConfig,
    createMemoryLifecycle,
    MemoryLifecycle,
    MemoryIntegrationOptions,
} from './memory';
```

This requires a `packages/pipeline-core/src/memory/index.ts` barrel file (may already exist from commits 002/003 — if not, create it).

## Tests

### `memory-integration.test.ts`

| Test case | What it verifies |
|-----------|-----------------|
| `normalizeMemoryConfig(true)` returns full config with defaults | Boolean expansion |
| `normalizeMemoryConfig(false)` returns null | Disabled |
| `normalizeMemoryConfig(undefined)` returns null | Absent |
| `normalizeMemoryConfig({ capture: true })` returns as-is | Object passthrough |
| `createMemoryLifecycle` — calls original invoker | Wrapper delegates correctly |
| `createMemoryLifecycle` — returns original result immediately | Non-blocking behavior |
| Capture fires in background after successful AI call | Observation capture triggers |
| Capture does NOT fire when AI call fails | Only capture on success |
| Capture errors don't propagate to caller | Error resilience |
| Phase `'map'` suppresses capture | Map-phase skip logic |
| Phase `'reduce'` enables capture | Reduce-phase capture |
| Phase `'job'` enables capture | Job-mode capture |
| `flush()` waits for all pending captures | Flush behavior |
| `flush()` resolves even if captures errored | Error resilience in flush |
| Integration: `executePipeline` with `memory: true` on a job | End-to-end wiring (mock AI) |
| Integration: `executePipeline` without memory — no capture | No regression |
| Integration: map-reduce pipeline captures once (at reduce) | Not per-item |

## Acceptance Criteria

- [ ] Pipeline with `memory: true` captures observations after execution
- [ ] Pipeline without `memory` behaves identically to before (no regression)
- [ ] Capture is non-blocking — pipeline latency not affected
- [ ] Map-reduce pipelines capture once at reduce, not per-item during map
- [ ] Phase switching uses existing `onPhaseChange` mechanism
- [ ] All memory types and functions exported from `pipeline-core/src/index.ts`
- [ ] `memory/index.ts` barrel re-exports all three prior commits' symbols
- [ ] Tests cover normalization, wrapping, phase logic, flush, error resilience
- [ ] No changes to `ExecutePipelineOptions` interface (memory config on `PipelineConfig`)
- [ ] No changes to CLI `run.ts` (wiring is internal to executor)
