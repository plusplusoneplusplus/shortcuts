---
status: pending
depends_on: ["001", "002", "003"]
commit: "004"
title: "withMemory() helper and exports wiring"
files_create:
  - packages/pipeline-core/src/memory/with-memory.ts
files_create_tests:
  - packages/pipeline-core/test/memory/with-memory.test.ts
files_modify:
  - packages/pipeline-core/src/memory/index.ts
  - packages/pipeline-core/src/index.ts
  - packages/pipeline-core/src/map-reduce/types.ts
---

# 004 — withMemory() helper and exports wiring

## Summary

Composable utility that orchestrates retrieve → tool injection → invoke → aggregate-check in a single function call. Plus wire all new memory services (from commits 001–003) into `pipeline-core` exports.

## Motivation

The design doc (`docs/designs/coc-memory.md`, §"withMemory() helper") specifies a convenience function for call sites that make a single AI call with memory. Without it, every caller must manually instantiate `MemoryRetriever`, call `createWriteMemoryTool`, enrich the prompt, merge tools, invoke, and run aggregation — six steps that `withMemory` reduces to one. This commit also wires all memory services into the public `pipeline-core` barrel so downstream consumers (`coc`, `coc-server`, VS Code extension) can import them.

## Prior commits

| Commit | File | Provides |
|--------|------|----------|
| 001 | `src/memory/memory-retriever.ts` | `MemoryRetriever` — `retrieve(level, repoHash?)` → `string \| null` |
| 002 | `src/memory/write-memory-tool.ts` | `createWriteMemoryTool(store, options)` → `{ tool, getWrittenFacts }` |
| 003 | `src/memory/memory-aggregator.ts` | `MemoryAggregator` — `aggregateIfNeeded(aiInvoker, level, repoHash?)`, `aggregate(...)` |

## Critical finding: `AIInvokerOptions` lacks a `tools` field

`AIInvokerOptions` (`packages/pipeline-core/src/map-reduce/types.ts:299-306`) currently has only:

```typescript
export interface AIInvokerOptions {
    model?: string;
    workingDirectory?: string;
    timeoutMs?: number;
}
```

There is **no `tools` field**. However, `SendMessageOptions` (`copilot-sdk-wrapper/types.ts:265-335`) does have `tools?: Tool<any>[]`, and the design doc explicitly shows tools flowing through the invoker options:

```typescript
aiInvoker(enrichedPrompt, { ...opts, tools: [...existingTools, memoryTool] })
```

**Resolution:** This commit adds an optional `tools` field to `AIInvokerOptions`:

```typescript
export interface AIInvokerOptions {
    model?: string;
    workingDirectory?: string;
    timeoutMs?: number;
    /** Custom tools to register on the AI session (SDK-native tools, not MCP). */
    tools?: import('../copilot-sdk-wrapper/types').Tool<any>[];
}
```

This is backward-compatible — existing callers that don't pass `tools` are unaffected. The `Tool` type is imported from `copilot-sdk-wrapper/types.ts` (already re-exported from pipeline-core's barrel). Callers that construct `AIInvoker` implementations (e.g., `createCLIAIInvoker`, `CopilotSDKService`-based invokers) can choose to forward the `tools` field to `SendMessageOptions.tools` when present.

> **Note:** This commit only adds the type. Actually threading `tools` through existing `AIInvoker` implementations (e.g., in `coc-server`'s queue executor or the VS Code AI service) is a separate concern for integration commits.

## Changes

### Files to Create

#### `packages/pipeline-core/src/memory/with-memory.ts`

```typescript
import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../map-reduce/types';
import type { MemoryStore, MemoryLevel } from './types';
import { MemoryRetriever } from './memory-retriever';
import { createWriteMemoryTool } from './write-memory-tool';
import { MemoryAggregator } from './memory-aggregator';
import { logger, LogCategory } from '../logger';

export interface WithMemoryOptions {
    store: MemoryStore;
    source: string;
    repoHash?: string;
    level?: MemoryLevel;        // default: 'both'
    model?: string;
    repo?: string;
    batchThreshold?: number;    // default: 5
}

export async function withMemory(
    aiInvoker: AIInvoker,
    prompt: string,
    invokerOptions: AIInvokerOptions,
    memoryOptions: WithMemoryOptions,
): Promise<AIInvokerResult> {
    const level = memoryOptions.level ?? 'both';

    // 1. Retrieve existing memory context
    let enrichedPrompt = prompt;
    try {
        const retriever = new MemoryRetriever(memoryOptions.store);
        const context = await retriever.retrieve(level, memoryOptions.repoHash);
        if (context) {
            enrichedPrompt = context + '\n\n' + prompt;
        }
    } catch (err) {
        logger.warn(LogCategory.Memory, `withMemory: retrieve failed, proceeding without context: ${err}`);
    }

    // 2. Create write_memory tool and merge with existing tools
    const { tool: memoryTool } = createWriteMemoryTool(memoryOptions.store, {
        source: memoryOptions.source,
        repoHash: memoryOptions.repoHash,
        level,
        model: memoryOptions.model,
        repo: memoryOptions.repo,
    });
    const existingTools = invokerOptions.tools ?? [];
    const mergedOptions: AIInvokerOptions = {
        ...invokerOptions,
        tools: [...existingTools, memoryTool],
    };

    // 3. Invoke AI with enriched prompt and injected tool
    const result = await aiInvoker(enrichedPrompt, mergedOptions);

    // 4. Check if aggregation is needed (non-blocking)
    try {
        const aggregator = new MemoryAggregator(memoryOptions.store, {
            batchThreshold: memoryOptions.batchThreshold ?? 5,
        });
        await aggregator.aggregateIfNeeded(aiInvoker, level, memoryOptions.repoHash);
    } catch (err) {
        logger.warn(LogCategory.Memory, `withMemory: aggregation check failed: ${err}`);
    }

    // 5. Return original AI result unchanged
    return result;
}
```

**Flow:**

1. Create `MemoryRetriever` from `memoryOptions.store`, call `retrieve(level, repoHash)` → context string or `null`
2. If context is non-null, prepend to prompt: `context + '\n\n' + prompt`
3. Create write_memory tool via `createWriteMemoryTool(store, { source, repoHash, level, model, repo })`
4. Merge tools: `[...invokerOptions.tools ?? [], memoryTool]` — preserves any tools already in `invokerOptions`
5. Invoke `aiInvoker(enrichedPrompt, { ...invokerOptions, tools: mergedTools })`
6. Call `aggregator.aggregateIfNeeded(aiInvoker, level, repoHash)` — non-blocking (errors caught)
7. Return original `AIInvokerResult` unchanged

**Error handling:**

- Retrieve failure → log warning, proceed with original prompt (no context)
- AI invocation failure → propagates to caller (this is the caller's primary operation)
- Aggregation failure → log warning, return result unchanged

#### `packages/pipeline-core/test/memory/with-memory.test.ts`

Vitest test file. All dependencies mocked — no filesystem I/O.

**Mock setup:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../../src/map-reduce/types';
import type { MemoryStore, MemoryLevel } from '../../src/memory/types';

// Mock the three memory service modules
vi.mock('../../src/memory/memory-retriever');
vi.mock('../../src/memory/write-memory-tool');
vi.mock('../../src/memory/memory-aggregator');
vi.mock('../../src/logger', () => ({
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    LogCategory: { Memory: 'Memory' },
}));

import { withMemory, WithMemoryOptions } from '../../src/memory/with-memory';
import { MemoryRetriever } from '../../src/memory/memory-retriever';
import { createWriteMemoryTool } from '../../src/memory/write-memory-tool';
import { MemoryAggregator } from '../../src/memory/memory-aggregator';
```

Each test creates a mock `AIInvoker` (`vi.fn()` returning a resolved `AIInvokerResult`), a mock `MemoryStore` (partial cast), and configures the mocked service module return values.

**Test cases:**

| # | Name | Setup | Assertion |
|---|------|-------|-----------|
| 1 | Calls retriever before invoking AI | Mock retriever returns `null` | `MemoryRetriever.prototype.retrieve` called before `aiInvoker` |
| 2 | Prepends retrieved context to prompt | Retriever returns `"## Context..."` | `aiInvoker` called with `"## Context...\n\n{original prompt}"` |
| 3 | Injects write_memory tool into AI call | Mock `createWriteMemoryTool` returns `{ tool: mockTool, getWrittenFacts: vi.fn() }` | `aiInvoker` called with `options.tools` containing `mockTool` |
| 4 | Passes through when no memory exists | Retriever returns `null` | `aiInvoker` called with original prompt unchanged |
| 5 | Does not modify prompt when retriever returns empty string | Retriever returns `""` (edge: treated as no content by retriever) | `aiInvoker` called with original prompt (retriever returns `null` for empty) |
| 6 | Calls aggregateIfNeeded after AI call | Default setup | `MemoryAggregator.prototype.aggregateIfNeeded` called with `aiInvoker`, `level`, `repoHash` |
| 7 | Returns original AIInvokerResult unchanged | `aiInvoker` returns specific result object | `withMemory` returns the exact same object (reference equality) |
| 8 | Handles retrieve failure gracefully | Retriever `.retrieve` rejects with `Error('disk')` | No error thrown; `aiInvoker` called with original prompt; `logger.warn` called |
| 9 | Handles aggregate failure gracefully | `aggregateIfNeeded` rejects with `Error('timeout')` | No error thrown; original AI result returned; `logger.warn` called |
| 10 | Preserves existing tools in invokerOptions | `invokerOptions.tools = [existingTool]` | `aiInvoker` called with `tools: [existingTool, memoryTool]` |

### Files to Modify

#### `packages/pipeline-core/src/map-reduce/types.ts`

Add `tools` to `AIInvokerOptions` (lines 299-306):

```typescript
// BEFORE:
export interface AIInvokerOptions {
    /** Model to use (optional, uses default if not specified) */
    model?: string;
    /** Working directory for execution */
    workingDirectory?: string;
    /** Timeout in ms */
    timeoutMs?: number;
}

// AFTER:
export interface AIInvokerOptions {
    /** Model to use (optional, uses default if not specified) */
    model?: string;
    /** Working directory for execution */
    workingDirectory?: string;
    /** Timeout in ms */
    timeoutMs?: number;
    /** Custom tools to register on the AI session (SDK-native tools, not MCP). */
    tools?: import('../copilot-sdk-wrapper/types').Tool<any>[];
}
```

This is backward-compatible: no existing caller passes `tools`, so no code is affected.

#### `packages/pipeline-core/src/memory/index.ts`

Add exports for all four new memory services:

```typescript
// BEFORE (current state):
export type {
    RawObservation,
    RawObservationMetadata,
    ConsolidatedMemory,
    MemoryIndex,
    RepoInfo,
    MemoryLevel,
    MemoryConfig,
    MemoryStoreOptions,
    MemoryStats,
    MemoryStore,
} from './types';

export { FileMemoryStore, computeRepoHash } from './memory-store';

// AFTER:
export type {
    RawObservation,
    RawObservationMetadata,
    ConsolidatedMemory,
    MemoryIndex,
    RepoInfo,
    MemoryLevel,
    MemoryConfig,
    MemoryStoreOptions,
    MemoryStats,
    MemoryStore,
} from './types';

export { FileMemoryStore, computeRepoHash } from './memory-store';
export { MemoryRetriever } from './memory-retriever';
export { createWriteMemoryTool } from './write-memory-tool';
export { MemoryAggregator } from './memory-aggregator';
export { withMemory } from './with-memory';
export type { WithMemoryOptions } from './with-memory';
```

#### `packages/pipeline-core/src/index.ts`

Add exports after the existing memory section (lines 978-991):

```typescript
// BEFORE (current state at lines 974-991):
// ============================================================================
// Memory
// ============================================================================

export type {
    RawObservation,
    RawObservationMetadata,
    ConsolidatedMemory,
    MemoryIndex,
    RepoInfo,
    MemoryLevel,
    MemoryConfig,
    MemoryStoreOptions,
    MemoryStats,
    MemoryStore,
} from './memory';

export { FileMemoryStore, computeRepoHash } from './memory';

// AFTER:
// ============================================================================
// Memory
// ============================================================================

export type {
    RawObservation,
    RawObservationMetadata,
    ConsolidatedMemory,
    MemoryIndex,
    RepoInfo,
    MemoryLevel,
    MemoryConfig,
    MemoryStoreOptions,
    MemoryStats,
    MemoryStore,
} from './memory';

export { FileMemoryStore, computeRepoHash } from './memory';
export { MemoryRetriever } from './memory';
export { createWriteMemoryTool } from './memory';
export { MemoryAggregator } from './memory';
export { withMemory } from './memory';
export type { WithMemoryOptions } from './memory';
```

This follows the existing pattern where the barrel `src/index.ts` re-exports from the module barrel `src/memory/index.ts`, keeping each export on its own line for clear git diffs.

## Implementation Notes

1. **Logger import** — `withMemory` uses `logger` and `LogCategory` from `../logger`. The `LogCategory.Memory` value should already exist (added in earlier memory commits). If not, use `LogCategory.AI` as fallback.

2. **`MemoryRetriever` returns `null` for no content** — per commit 001, `retrieve()` returns `string | null`. The retriever already handles empty-string-as-null internally, so `withMemory` only checks for `null`.

3. **`createWriteMemoryTool` returns `{ tool, getWrittenFacts }`** — per commit 002. Only `tool` is needed by `withMemory`; `getWrittenFacts` is for callers who want to inspect what was captured.

4. **`MemoryAggregator` constructor** — per commit 003, takes `(store, options?)` where options includes `batchThreshold`. The `aggregateIfNeeded` method checks raw observation count against the threshold.

5. **Tool type** — `createWriteMemoryTool` returns a `Tool<any>` from `copilot-sdk-wrapper/types.ts`. This is the same type now added to `AIInvokerOptions.tools`.

6. **No `MemoryStore` construction** — `withMemory` receives the store from the caller. It does not create a `FileMemoryStore`. This keeps the helper pure and testable.

## Acceptance Criteria

- [ ] `withMemory` exported from `packages/pipeline-core/src/memory/index.ts`
- [ ] `WithMemoryOptions` type exported from `packages/pipeline-core/src/memory/index.ts`
- [ ] `AIInvokerOptions` in `map-reduce/types.ts` has optional `tools` field
- [ ] `withMemory` calls `MemoryRetriever.retrieve` before AI invocation
- [ ] `withMemory` prepends retrieved context to prompt when present
- [ ] `withMemory` creates and injects `write_memory` tool via `createWriteMemoryTool`
- [ ] `withMemory` preserves existing tools from `invokerOptions.tools`
- [ ] `withMemory` calls `MemoryAggregator.aggregateIfNeeded` after AI invocation
- [ ] Retrieve failure logs warning and proceeds without context
- [ ] Aggregate failure logs warning and returns result unchanged
- [ ] AI invoker failure propagates to caller (not swallowed)
- [ ] `withMemory` returns the original `AIInvokerResult` unchanged
- [ ] `MemoryRetriever`, `createWriteMemoryTool`, `MemoryAggregator`, `withMemory`, `WithMemoryOptions` all exported from `packages/pipeline-core/src/index.ts`
- [ ] All 10 tests pass (`npm run test:run` in `packages/pipeline-core`)
- [ ] `npm run build` passes

## Dependencies

- **Depends on:** 001 (`MemoryRetriever`), 002 (`createWriteMemoryTool`), 003 (`MemoryAggregator`)
- **Depended on by:** Integration commits that call `withMemory` from pipeline executor, queue executor, etc.
