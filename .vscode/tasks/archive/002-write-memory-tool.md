---
status: done
---

# 002: createWriteMemoryTool — Tool Factory for AI-Driven Memory Capture

## Summary

A tool factory that creates a `write_memory` tool following the `defineTool` pattern from `copilot-sdk-wrapper`. The AI calls this tool when it notices facts worth remembering. The handler writes raw observations to MemoryStore.

## Motivation

Instead of a follow-up prompt, memory-enabled AI sessions receive a `write_memory` tool. The AI decides organically when to call it — no extra messages, no session history pollution, no extra AI calls. This follows the design in `docs/designs/coc-memory.md` § "2. Capture (Tool-Based)".

The factory pattern mirrors `createResolveCommentTool` in `packages/coc/src/server/resolve-comment-tool.ts`: per-invocation factory returns `{ tool, getWrittenFacts }` so each AI call gets its own accumulator, avoiding cross-request contamination.

## Changes

### Files to Create

#### `packages/pipeline-core/src/memory/write-memory-tool.ts`

Tool factory module. Key design:

```typescript
import { defineTool, Tool } from '../copilot-sdk-wrapper/types';
import { MemoryStore, MemoryLevel, RawObservationMetadata } from './types';

// --- Option & argument interfaces ---

export interface WriteMemoryToolOptions {
    /** Source pipeline/feature name (e.g. 'code-review', 'wiki-ask') */
    source: string;
    /** Repo hash for repo-level writes. Omit for system-only. */
    repoHash?: string;
    /** Memory level to write to. Default: 'both' */
    level?: MemoryLevel;
    /** AI model name for observation metadata */
    model?: string;
    /** Repository identifier for observation metadata (e.g. 'github/shortcuts') */
    repo?: string;
}

export interface WriteMemoryArgs {
    /** A concise fact to remember (one sentence) */
    fact: string;
    /** Topic category for the fact */
    category?: string;
}

// --- Factory function ---

export function createWriteMemoryTool(
    store: MemoryStore,
    options: WriteMemoryToolOptions,
): { tool: Tool<WriteMemoryArgs>; getWrittenFacts: () => string[] } {
    const writtenFacts: string[] = [];
    const level = options.level ?? 'both';

    const tool = defineTool<WriteMemoryArgs>('write_memory', {
        description:
            'Store a fact worth remembering for future tasks on this codebase. '
            + 'Call this when you notice coding conventions, architecture decisions, '
            + 'common gotchas, or tool/library usage patterns.',
        parameters: {
            type: 'object',
            properties: {
                fact: { type: 'string', description: 'A concise fact to remember (one sentence)' },
                category: {
                    type: 'string',
                    enum: ['conventions', 'architecture', 'gotchas', 'tools', 'patterns'],
                    description: 'Topic category for the fact',
                },
            },
            required: ['fact'],
        },
        handler: async (args) => {
            const metadata: RawObservationMetadata = {
                pipeline: options.source,
                timestamp: new Date().toISOString(),
                ...(options.repo && { repo: options.repo }),
                ...(options.model && { model: options.model }),
            };

            const content = args.category
                ? `## ${args.category}\n\n- ${args.fact}`
                : `- ${args.fact}`;

            await store.writeRaw(level, options.repoHash, metadata, content);
            writtenFacts.push(args.fact);

            return { stored: true };
        },
    });

    return { tool, getWrittenFacts: () => [...writtenFacts] };
}
```

**Import path rationale:** The file lives at `packages/pipeline-core/src/memory/write-memory-tool.ts`. It imports `defineTool` and `Tool` from `../copilot-sdk-wrapper/types` (relative path within the same package). This matches how other intra-package modules import — no circular dependency since `copilot-sdk-wrapper/types.ts` has no imports from `memory/`.

**Key implementation details:**

1. `defineTool<WriteMemoryArgs>('write_memory', { ... })` — matches the exact signature in `copilot-sdk-wrapper/types.ts` line 80-86:
   ```typescript
   export function defineTool<T = unknown>(name: string, config: {
       description?: string;
       parameters?: ZodSchema<T> | Record<string, unknown>;
       handler: ToolHandler<T>;
   }): Tool<T>
   ```
   The `parameters` field uses a plain JSON Schema object (`Record<string, unknown>`), not Zod — matching the `createResolveCommentTool` pattern.

2. Handler is `async` because `store.writeRaw()` returns `Promise<string>`. The `ToolHandler` type allows returning `Promise<unknown> | unknown` (line 50-53 of types.ts).

3. For `level='both'`, a single `store.writeRaw('both', ...)` call suffices — `FileMemoryStore.writeRaw` already handles writing to both system and repo directories internally (memory-store.ts lines 160-165).

4. `writtenFacts` is a mutable array captured in the factory closure, accumulating facts across multiple tool calls in one session.

5. `getWrittenFacts()` returns a shallow copy (`[...writtenFacts]`) to prevent external mutation — matching the `getResolvedIds` pattern in resolve-comment-tool.ts.

#### `packages/pipeline-core/test/memory/write-memory-tool.test.ts`

Vitest test file. Uses a mock `MemoryStore` (only `writeRaw` needs implementation; other methods can be stubs).

**Test cases:**

1. **Tool has correct name and description**
   - Create tool via `createWriteMemoryTool(mockStore, { source: 'test' })`
   - Assert `tool.name === 'write_memory'`
   - Assert `tool.description` includes 'Store a fact'

2. **Handler writes raw observation via store.writeRaw**
   - Mock `writeRaw` with `vi.fn()` that returns `Promise.resolve('filename.md')`
   - Call `tool.handler({ fact: 'Use tabs' }, mockInvocation)`
   - Assert `writeRaw` was called once

3. **Metadata includes source, timestamp, model, repo from options**
   - Create tool with `{ source: 'code-review', model: 'gpt-5', repo: 'org/repo' }`
   - Call handler
   - Inspect the `metadata` argument passed to `writeRaw`:
     - `metadata.pipeline === 'code-review'`
     - `metadata.timestamp` is a valid ISO string
     - `metadata.model === 'gpt-5'`
     - `metadata.repo === 'org/repo'`

4. **Fact content is written as observation body**
   - Call handler with `{ fact: 'Always use strict mode', category: 'conventions' }`
   - Inspect the `content` argument passed to `writeRaw`
   - Assert it contains the fact text

5. **getWrittenFacts returns all facts written during session**
   - Call handler twice with different facts
   - Assert `getWrittenFacts()` returns both facts

6. **Handles level='both' — writes to both system and repo levels**
   - Create tool with `{ source: 'test', level: 'both', repoHash: 'abc123' }`
   - Call handler
   - Assert `writeRaw` was called with `level='both'` and `repoHash='abc123'`

7. **Handles level='repo' — writes to repo only**
   - Create tool with `{ source: 'test', level: 'repo', repoHash: 'abc123' }`
   - Call handler
   - Assert `writeRaw` was called with `level='repo'`

8. **Handles level='system' — writes to system only**
   - Create tool with `{ source: 'test', level: 'system' }`
   - Call handler
   - Assert `writeRaw` was called with `level='system'` and `repoHash=undefined`

9. **Multiple tool calls accumulate facts**
   - Call handler 3 times with 3 different facts
   - Assert `getWrittenFacts().length === 3`
   - Assert all 3 facts are present

10. **Handler returns { stored: true }**
    - Call handler
    - Assert return value is `{ stored: true }`

**Mock setup pattern:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWriteMemoryTool, WriteMemoryToolOptions } from '../../src/memory/write-memory-tool';
import { MemoryStore } from '../../src/memory/types';
import { ToolInvocation } from '../../src/copilot-sdk-wrapper/types';

function createMockStore(): MemoryStore {
    return {
        writeRaw: vi.fn().mockResolvedValue('mock-filename.md'),
        listRaw: vi.fn().mockResolvedValue([]),
        readRaw: vi.fn().mockResolvedValue(undefined),
        deleteRaw: vi.fn().mockResolvedValue(false),
        readConsolidated: vi.fn().mockResolvedValue(null),
        writeConsolidated: vi.fn().mockResolvedValue(undefined),
        readIndex: vi.fn().mockResolvedValue({ lastAggregation: null, rawCount: 0, factCount: 0, categories: [] }),
        updateIndex: vi.fn().mockResolvedValue(undefined),
        getRepoInfo: vi.fn().mockResolvedValue(null),
        updateRepoInfo: vi.fn().mockResolvedValue(undefined),
        computeRepoHash: vi.fn().mockReturnValue('mock-hash'),
        clear: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockResolvedValue({ rawCount: 0, consolidatedExists: false, lastAggregation: null, factCount: 0 }),
        listRepos: vi.fn().mockResolvedValue([]),
        getSystemDir: vi.fn().mockReturnValue('/mock/system'),
        getRepoDir: vi.fn().mockReturnValue('/mock/repo'),
    };
}

const mockInvocation: ToolInvocation = {
    sessionId: 'test-session',
    toolCallId: 'test-call-1',
    toolName: 'write_memory',
    arguments: {},
};
```

### Files to Modify

#### `packages/pipeline-core/src/memory/index.ts`

Add export for `createWriteMemoryTool` and its option/arg interfaces:

```typescript
// After existing exports, add:
export { createWriteMemoryTool, WriteMemoryToolOptions, WriteMemoryArgs } from './write-memory-tool';
```

This makes the factory available via `import { createWriteMemoryTool } from '@plusplusoneplusplus/pipeline-core'` (since `packages/pipeline-core/src/index.ts` already re-exports everything from `./memory`).

### Files to Delete

- None

## Implementation Notes

1. **Import chain verification:** `defineTool` and `Tool` are defined in `copilot-sdk-wrapper/types.ts` (lines 69-86), re-exported from `copilot-sdk-wrapper/index.ts` (lines 33-36), then re-exported from `pipeline-core/src/index.ts` (lines 331-334). The new file uses the relative import `../copilot-sdk-wrapper/types` to avoid going through the package index.

2. **No circular dependency risk:** `copilot-sdk-wrapper/types.ts` imports only from `../ai/types` and `../ai/process-types` — it does not import from `memory/`. The new `write-memory-tool.ts` imports from `../copilot-sdk-wrapper/types` (one direction only).

3. **`store.writeRaw` already handles `level='both'`:** Looking at `FileMemoryStore.writeRaw` (memory-store.ts lines 142-169), when `level='both'`, it writes to both `system/raw/` and `repos/<hash>/raw/` directories. The tool factory does NOT need to call `writeRaw` twice — a single call with `level='both'` suffices.

4. **JSON Schema for parameters (not Zod):** The `parameters` field accepts either `ZodSchema<T>` or `Record<string, unknown>`. We use plain JSON Schema (matching `createResolveCommentTool` in resolve-comment-tool.ts lines 24-30). This avoids a Zod dependency in pipeline-core.

5. **Timestamp generation:** Each handler invocation generates its own ISO timestamp via `new Date().toISOString()`. This ensures each fact gets a unique timestamp even when multiple `write_memory` calls happen in rapid succession.

6. **Category formatting:** When a `category` is provided, the fact is written with a markdown header (`## category\n\n- fact`). Without a category, it's just `- fact`. This matches the raw observation format expected by the aggregation phase.

## Tests

All tests use Vitest (matching the package's test infrastructure). Run with:

```bash
cd packages/pipeline-core && npx vitest run test/memory/write-memory-tool.test.ts
```

See the 10 test cases enumerated above under "Files to Create".

## Acceptance Criteria

- [ ] `createWriteMemoryTool` is exported from `packages/pipeline-core/src/memory/write-memory-tool.ts`
- [ ] `WriteMemoryToolOptions` and `WriteMemoryArgs` interfaces are exported
- [ ] `createWriteMemoryTool` is re-exported from `packages/pipeline-core/src/memory/index.ts`
- [ ] Factory returns `{ tool, getWrittenFacts }` matching the `createResolveCommentTool` pattern
- [ ] `tool.name === 'write_memory'`
- [ ] Tool description matches the design doc text
- [ ] Tool parameters use JSON Schema with `fact` (required) and `category` (optional enum)
- [ ] Handler calls `store.writeRaw(level, repoHash, metadata, content)`
- [ ] Handler returns `{ stored: true }`
- [ ] `getWrittenFacts()` returns accumulated facts across multiple calls
- [ ] Default `level` is `'both'` when not specified in options
- [ ] All 10 test cases pass
- [ ] `npm run build` succeeds with no type errors
- [ ] `cd packages/pipeline-core && npx vitest run test/memory/write-memory-tool.test.ts` passes

## Dependencies

- Depends on: Memory store implementation (`packages/pipeline-core/src/memory/memory-store.ts`) — already merged
- Depends on: `defineTool` / `Tool` types in `copilot-sdk-wrapper/types.ts` — already merged
