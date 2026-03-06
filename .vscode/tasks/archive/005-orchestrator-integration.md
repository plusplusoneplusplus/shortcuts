---
status: pending
---

# 005: Orchestrator, Presets & Integration

## Summary

Creates the `withToolCallCache()` orchestrator function (mirroring `withMemory()`), defines preset `ToolCallFilter` instances (including `EXPLORE_FILTER`), exports everything from the `memory/` barrel, and extends `PipelineConfig` with the `toolCallCache` field.

## Motivation

Commits 001–004 built the four independent layers (store, capture, aggregation, retrieval) but left them as isolated classes. This commit wires them into a single, ergonomic `withToolCallCache()` function that callers can use the same way they use `withMemory()` today — a one-liner that transparently captures tool-call Q&A pairs and triggers aggregation. Without this orchestrator, every caller would have to manually instantiate `ToolCallCapture`, merge `onToolEvent`, instantiate `ToolCallCacheAggregator`, and coordinate the post-invocation aggregation check. The preset filters give callers well-tested, named configurations (especially `EXPLORE_FILTER` for the primary use case). Barrel exports and the `PipelineConfig` extension complete the public API surface so that downstream consumers (`coc`, `deep-wiki`, pipeline executor) can import everything from `@plusplusoneplusplus/pipeline-core/memory`.

## Changes

### Files to Create

- `packages/pipeline-core/src/memory/with-tool-call-cache.ts` — The `withToolCallCache()` orchestrator function and its `WithToolCallCacheOptions` interface.
- `packages/pipeline-core/src/memory/tool-call-cache-presets.ts` — Preset `ToolCallFilter` instances: `EXPLORE_FILTER`, `ALL_TOOLS_FILTER`, and the `createToolNameFilter()` factory function.
- `packages/pipeline-core/test/memory/with-tool-call-cache.test.ts` — Unit tests for the orchestrator function.
- `packages/pipeline-core/test/memory/tool-call-cache-presets.test.ts` — Unit tests for preset filters.

### Files to Modify

- `packages/pipeline-core/src/memory/index.ts` — Add barrel re-exports for all six new tool-call-cache modules (types, store, capture, aggregator, retriever, orchestrator, presets).
- `packages/pipeline-core/src/pipeline/types.ts` — Add `toolCallCache?: ToolCallCacheConfig` field to the `PipelineConfig` interface.

### Files to Delete

(none)

## Implementation Notes

### 1. `withToolCallCache()` Orchestrator — Full Flow

The orchestrator mirrors the `withMemory()` pattern in `packages/pipeline-core/src/memory/with-memory.ts` (retrieve → invoke → aggregate). Key difference: `withMemory()` enriches the **prompt** and injects a **tool**; `withToolCallCache()` installs an **onToolEvent callback** on the invoker options and triggers aggregation post-invocation.

```
withToolCallCache(aiInvoker, prompt, invokerOptions, cacheOptions)
  │
  ├─ 1. Create ToolCallCapture instance
  │     new ToolCallCapture(cacheOptions.store, {
  │       filter: cacheOptions.filter,
  │       gitHash: cacheOptions.gitHash,
  │       repoHash: cacheOptions.repoHash,
  │     })
  │
  ├─ 2. Merge onToolEvent callback
  │     • Extract existing callback: invokerOptions.onToolEvent (may be undefined)
  │     • Create merged callback that calls BOTH:
  │       (a) existing callback (if any)
  │       (b) capture.createToolEventHandler()
  │     • Set merged callback on invokerOptions copy
  │
  ├─ 3. Invoke AI with modified invokerOptions
  │     const result = await aiInvoker(prompt, mergedOptions)
  │
  ├─ 4. Post-invocation aggregation check (non-blocking, try/catch)
  │     new ToolCallCacheAggregator(cacheOptions.store, {
  │       batchThreshold: cacheOptions.batchThreshold ?? 10,
  │     }).aggregateIfNeeded(aiInvoker, cacheOptions.repoHash)
  │
  └─ 5. Return original AI result unchanged
```

**Critical design decision — onToolEvent merging:**

The `AIInvokerOptions` type (in `packages/pipeline-core/src/map-reduce/types.ts`) does NOT include `onToolEvent`. That callback lives on `SendMessageOptions` (in `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts`). The orchestrator must work at the **AIInvoker abstraction level** (same as `withMemory()`), not the SDK level. This means:

1. The `invokerOptions` parameter is typed as `AIInvokerOptions` (from map-reduce types), which has `model`, `workingDirectory`, `timeoutMs`, `tools`.
2. However, callers that pass SDK-level options will include `onToolEvent` as an extra property. The orchestrator should accept a **superset** that includes an optional `onToolEvent`.
3. Solution: Define a local extended type:
   ```typescript
   interface AIInvokerOptionsWithToolEvent extends AIInvokerOptions {
     onToolEvent?: (event: ToolEvent) => void;
   }
   ```
   This keeps the orchestrator at the map-reduce abstraction but allows the SDK-level callback to flow through.

**onToolEvent merge function:**

```typescript
function mergeToolEventHandlers(
  existing: ((event: ToolEvent) => void) | undefined,
  capture: (event: ToolEvent) => void,
): (event: ToolEvent) => void {
  if (!existing) return capture;
  return (event: ToolEvent) => {
    // Always call existing handler first (preserve caller behavior)
    try { existing(event); } catch { /* swallow — caller's handler error shouldn't break capture */ }
    // Then call capture handler
    try { capture(event); } catch { /* swallow — capture error shouldn't break pipeline */ }
  };
}
```

**Error handling:** Every step (capture creation, onToolEvent handler, aggregation) is wrapped in try/catch with `getLogger().warn(LogCategory.Memory, ...)` — matching the pattern in `withMemory()`. Failures never propagate to the caller. The AI result is always returned unchanged.

**Interface:**

```typescript
import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../map-reduce/types';
import type { ToolEvent } from '../copilot-sdk-wrapper/types';
import type { ToolCallCacheStore, ToolCallFilter, MemoryLevel } from './tool-call-cache-types';
import { ToolCallCapture } from './tool-call-capture';
import { ToolCallCacheAggregator } from './tool-call-cache-aggregator';
import { getLogger, LogCategory } from '../logger';

export interface WithToolCallCacheOptions {
  /** The backing store for raw Q&A entries and consolidated index */
  store: ToolCallCacheStore;
  /** Filter determining which tool calls to capture */
  filter: ToolCallFilter;
  /** Current repo hash for scoped storage */
  repoHash?: string;
  /** Current git HEAD hash for staleness tracking */
  gitHash?: string;
  /** Memory isolation level (default: 'repo') */
  level?: MemoryLevel;
  /** AI model identifier for metadata */
  model?: string;
  /** Number of raw entries before triggering aggregation (default: 10) */
  batchThreshold?: number;
  /** How to handle stale cache entries: 'skip' ignores them, 'warn' returns with warning, 'revalidate' triggers AI re-check */
  stalenessStrategy?: 'skip' | 'warn' | 'revalidate';
}

/** Extended invoker options that may include the SDK-level onToolEvent */
interface AIInvokerOptionsWithToolEvent extends AIInvokerOptions {
  onToolEvent?: (event: ToolEvent) => void;
}

export async function withToolCallCache(
  aiInvoker: AIInvoker,
  prompt: string,
  invokerOptions: AIInvokerOptionsWithToolEvent,
  cacheOptions: WithToolCallCacheOptions,
): Promise<AIInvokerResult>
```

### 2. `tool-call-cache-presets.ts` — Preset Filters

Each preset is a `ToolCallFilter` object (defined in commit 001's `tool-call-cache-types.ts`). The `ToolCallFilter` type is a function: `(toolName: string, args: Record<string, unknown>) => boolean`.

**`EXPLORE_FILTER`:**

Matches tools that are read-only, exploration-oriented. Specifically:

| Tool Name | Match Condition |
|-----------|----------------|
| `grep` | Always (read-only search) |
| `glob` | Always (file pattern matching) |
| `view` | Always (file/directory viewing) |
| `read_file` | Always (alias for view in some backends) |
| `list_directory` | Always (alias for view in some backends) |
| `task` | Only when `args.agent_type === 'explore'` |

Implementation:

```typescript
const EXPLORE_TOOL_NAMES = new Set([
  'grep', 'glob', 'view', 'read_file', 'list_directory',
]);

export const EXPLORE_FILTER: ToolCallFilter = (
  toolName: string,
  args: Record<string, unknown>,
): boolean => {
  if (EXPLORE_TOOL_NAMES.has(toolName)) return true;
  if (toolName === 'task' && args.agent_type === 'explore') return true;
  return false;
};
```

**`ALL_TOOLS_FILTER`:**

Matches every tool call — useful for debugging/analysis, not recommended for production.

```typescript
export const ALL_TOOLS_FILTER: ToolCallFilter = () => true;
```

**`createToolNameFilter()`:**

Factory function for custom name-based filters (no args inspection).

```typescript
export function createToolNameFilter(...names: string[]): ToolCallFilter {
  const nameSet = new Set(names);
  return (toolName: string) => nameSet.has(toolName);
}
```

### 3. Barrel Exports in `memory/index.ts`

Add these export blocks **after** the existing `withMemory` exports (line 25):

```typescript
// --- Tool Call Cache ---
export type {
  ToolCallCacheEntry,
  ToolCallCacheEntryMetadata,
  ToolCallCacheIndex,
  ToolCallCacheConsolidatedEntry,
  ToolCallCacheLookupResult,
  ToolCallCacheStore,
  ToolCallCacheStoreOptions,
  ToolCallFilter,
  ToolCallCacheConfig,
} from './tool-call-cache-types';

export { FileToolCallCacheStore } from './tool-call-cache-store';
export { ToolCallCapture } from './tool-call-capture';
export { ToolCallCacheAggregator } from './tool-call-cache-aggregator';
export type { ToolCallCacheAggregatorOptions } from './tool-call-cache-aggregator';
export { ToolCallCacheRetriever } from './tool-call-cache-retriever';
export { withToolCallCache } from './with-tool-call-cache';
export type { WithToolCallCacheOptions } from './with-tool-call-cache';
export { EXPLORE_FILTER, ALL_TOOLS_FILTER, createToolNameFilter } from './tool-call-cache-presets';
```

The exact type/value names may vary slightly from the commit 001–004 implementations, but the pattern follows the existing barrel (e.g., `FileMemoryStore` ↔ `FileToolCallCacheStore`, `MemoryAggregator` ↔ `ToolCallCacheAggregator`).

### 4. `PipelineConfig` Extension

In `packages/pipeline-core/src/pipeline/types.ts`, add after the existing `parameters` field (around line 79):

```typescript
/** Optional tool call cache configuration for capturing explore-like tool calls */
toolCallCache?: ToolCallCacheConfig;
```

This requires importing `ToolCallCacheConfig` from the memory types:

```typescript
import type { ToolCallCacheConfig } from '../memory/tool-call-cache-types';
```

The `ToolCallCacheConfig` type (defined in commit 001) mirrors `MemoryConfig`:

```typescript
interface ToolCallCacheConfig {
  /** Whether to capture tool call Q&A pairs during AI invocations */
  capture: boolean;
  /** Whether to check the cache before tool execution */
  retrieve: boolean;
  /** Which filter preset to use (default: 'explore') */
  filter?: 'explore' | 'all' | string;
  /** Memory level for storage (default: 'repo') */
  level?: MemoryLevel;
}
```

### 5. Comparison with `withMemory()` Pattern

| Aspect | `withMemory()` | `withToolCallCache()` |
|--------|---------------|----------------------|
| Pre-invoke | Retrieves consolidated memory → enriches prompt | (Future: retriever lookup — not wired in v1, but `ToolCallCacheRetriever` is instantiated for API symmetry) |
| During invoke | Injects `write_memory` tool into `tools[]` | Merges `onToolEvent` callback to capture tool calls |
| Post-invoke | `aggregateIfNeeded()` — non-blocking | `aggregateIfNeeded()` — non-blocking |
| Error handling | try/catch + logger.warn per step | Identical pattern |
| Return value | Original `AIInvokerResult` unchanged | Original `AIInvokerResult` unchanged |

### 6. Why `ToolCallCacheRetriever` Is Not Wired Pre-Invocation (v1)

In the `withMemory()` flow, retrieval enriches the prompt (text injection). For tool-call cache, retrieval would need to intercept tool calls **before** they execute and short-circuit with cached answers. This requires a `onBeforeToolExecution` hook that doesn't exist in the SDK yet. Therefore, v1 only does **capture + aggregation**. The retriever is available as a standalone class for callers who want to manually check the cache, but it's not automatically wired into the orchestrator flow. A comment in the code should document this:

```typescript
// NOTE: Pre-execution retrieval (cache hit → skip tool) requires an onBeforeToolExecution
// hook in the SDK. For v1, we only capture + aggregate. Retrieval is available via
// ToolCallCacheRetriever for manual use by callers.
```

## Tests

### `with-tool-call-cache.test.ts`

Follows the exact mocking pattern from `test/memory/with-memory.test.ts`:
- `vi.mock()` for `ToolCallCapture`, `ToolCallCacheAggregator`, `ToolCallCacheRetriever`, and logger
- Mock `AIInvoker`, mock `ToolCallCacheStore`
- Tests:

1. **wires onToolEvent correctly** — Verify that when `invokerOptions` has no existing `onToolEvent`, the orchestrator sets one that delegates to `capture.createToolEventHandler()`. Invoke the AI, then call the wired `onToolEvent` on the options that were passed to the invoker, verify the capture handler receives the event.

2. **preserves existing onToolEvent callback** — Pass `invokerOptions` with an existing `onToolEvent` spy. Verify both the existing spy AND the capture handler are called when the merged handler fires. Verify existing is called first.

3. **existing onToolEvent error doesn't break capture** — Pass an `onToolEvent` that throws. Verify the capture handler is still called. Verify no error propagates.

4. **triggers aggregation post-invocation** — Verify `ToolCallCacheAggregator.aggregateIfNeeded()` is called after the AI invoker resolves, with the correct repoHash.

5. **aggregation uses custom batchThreshold** — Pass `batchThreshold: 20` in cache options. Verify the `ToolCallCacheAggregator` constructor receives `{ batchThreshold: 20 }`.

6. **returns AI result unchanged** — Verify the return value is the exact same object reference as what the mock invoker returned.

7. **graceful on capture creation error** — Mock `ToolCallCapture` constructor to throw. Verify the AI is still invoked (without onToolEvent modification), and the result is returned.

8. **graceful on aggregation error** — Mock `aggregateIfNeeded` to reject. Verify the AI result is still returned, and `logger.warn` is called with `'Memory'` category.

9. **passes prompt through unchanged** — Unlike `withMemory()` which enriches the prompt, `withToolCallCache()` passes it through as-is. Verify the exact prompt string reaches the invoker.

10. **uses default batchThreshold of 10** — When `batchThreshold` is not specified, verify the aggregator is constructed with `{ batchThreshold: 10 }`.

### `tool-call-cache-presets.test.ts`

1. **EXPLORE_FILTER matches grep** — `EXPLORE_FILTER('grep', { pattern: 'foo' })` returns `true`.
2. **EXPLORE_FILTER matches glob** — `EXPLORE_FILTER('glob', { pattern: '**/*.ts' })` returns `true`.
3. **EXPLORE_FILTER matches view** — `EXPLORE_FILTER('view', { path: '/src/index.ts' })` returns `true`.
4. **EXPLORE_FILTER matches read_file** — `EXPLORE_FILTER('read_file', {})` returns `true`.
5. **EXPLORE_FILTER matches list_directory** — `EXPLORE_FILTER('list_directory', {})` returns `true`.
6. **EXPLORE_FILTER matches task with agent_type=explore** — `EXPLORE_FILTER('task', { agent_type: 'explore' })` returns `true`.
7. **EXPLORE_FILTER rejects task with agent_type=general-purpose** — `EXPLORE_FILTER('task', { agent_type: 'general-purpose' })` returns `false`.
8. **EXPLORE_FILTER rejects task with no agent_type** — `EXPLORE_FILTER('task', {})` returns `false`.
9. **EXPLORE_FILTER rejects edit** — `EXPLORE_FILTER('edit', {})` returns `false`.
10. **EXPLORE_FILTER rejects create** — `EXPLORE_FILTER('create', {})` returns `false`.
11. **EXPLORE_FILTER rejects powershell/bash** — `EXPLORE_FILTER('powershell', {})` returns `false`.
12. **ALL_TOOLS_FILTER matches everything** — `ALL_TOOLS_FILTER('anything', {})` returns `true`.
13. **ALL_TOOLS_FILTER matches empty name** — `ALL_TOOLS_FILTER('', {})` returns `true`.
14. **createToolNameFilter produces correct filter** — `createToolNameFilter('grep', 'view')` returns a filter that matches `grep` and `view` but rejects `edit`.
15. **createToolNameFilter with no names matches nothing** — `createToolNameFilter()` rejects everything.

## Acceptance Criteria

- [ ] `withToolCallCache()` has the same API shape as `withMemory()`: `(aiInvoker, prompt, invokerOptions, cacheOptions) => Promise<AIInvokerResult>`
- [ ] `withToolCallCache()` merges `onToolEvent` without losing existing callbacks
- [ ] `withToolCallCache()` triggers aggregation post-invocation (non-blocking, error-tolerant)
- [ ] `withToolCallCache()` returns the AI result unchanged (same object reference)
- [ ] `withToolCallCache()` is fully error-tolerant: capture/aggregation failures logged but never propagated
- [ ] `EXPLORE_FILTER` correctly identifies explore-like tools: grep, glob, view, read_file, list_directory, task(explore)
- [ ] `EXPLORE_FILTER` rejects mutating tools: edit, create, powershell, bash, task(non-explore)
- [ ] `createToolNameFilter()` produces a working `ToolCallFilter` from a list of tool names
- [ ] `ALL_TOOLS_FILTER` matches every tool call unconditionally
- [ ] All new modules exported from `memory/index.ts` barrel — no internal modules left unexported
- [ ] `PipelineConfig` interface in `pipeline/types.ts` extended with `toolCallCache?: ToolCallCacheConfig`
- [ ] Import of `ToolCallCacheConfig` in `pipeline/types.ts` does not break existing builds
- [ ] No breaking changes to existing `withMemory()`, `MemoryStore`, `PipelineConfig`, or `AIInvokerOptions` APIs
- [ ] All tests pass: `npm run test:run` in `packages/pipeline-core/`

## Dependencies

- Depends on: 001 (types + store), 002 (capture), 003 (aggregator), 004 (retriever)

## Assumed Prior State

All four prior commits have been applied. The following artifacts exist:

| Commit | File | Key Exports |
|--------|------|-------------|
| 001 | `src/memory/tool-call-cache-types.ts` | `ToolCallCacheEntry`, `ToolCallCacheEntryMetadata`, `ToolCallCacheIndex`, `ToolCallCacheConsolidatedEntry`, `ToolCallCacheLookupResult`, `ToolCallCacheStore`, `ToolCallCacheStoreOptions`, `ToolCallFilter`, `ToolCallCacheConfig` |
| 001 | `src/memory/tool-call-cache-store.ts` | `FileToolCallCacheStore` (implements `ToolCallCacheStore`) |
| 002 | `src/memory/tool-call-capture.ts` | `ToolCallCapture` — class with `createToolEventHandler()` returning `(event: ToolEvent) => void`, and `normalizeToolArgs()` |
| 003 | `src/memory/tool-call-cache-aggregator.ts` | `ToolCallCacheAggregator` — class with `aggregateIfNeeded(aiInvoker, repoHash?)` and `aggregate(aiInvoker, repoHash?)`, `ToolCallCacheAggregatorOptions` |
| 004 | `src/memory/tool-call-cache-retriever.ts` | `ToolCallCacheRetriever` — class with `lookup(toolName, args, options?)` returning `ToolCallCacheLookupResult` |

The `memory/index.ts` barrel does NOT yet export any of these modules (that's part of this commit).
