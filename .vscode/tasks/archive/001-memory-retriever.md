---
status: done
---
# 001: MemoryRetriever — load and format consolidated memory

## Summary

Standalone service that reads `consolidated.md` from repo and/or system levels via `MemoryStore`, formats the content as a markdown context block suitable for prompt injection.

## Motivation

The design doc (`docs/designs/coc-memory.md`, §1 "Retrieve (Pre-Call)") specifies that before every AI call the caller must load consolidated memory and prepend it to the prompt as a structured markdown block. Currently no service encapsulates this retrieval + formatting logic. `MemoryRetriever` extracts this into a single, testable class so callers (pipeline executor, AI service) only need `retrieve(level, repoHash?)` instead of manually reading and concatenating markdown.

## Changes

### Files to Create

#### `packages/pipeline-core/src/memory/memory-retriever.ts`

```typescript
import { MemoryStore, MemoryLevel } from './types';

export class MemoryRetriever {
    constructor(private store: MemoryStore) {}

    async retrieve(level: MemoryLevel, repoHash?: string): Promise<string | null>;
}
```

**Behavior by `level`:**

| `level` | Action |
|---------|--------|
| `'repo'` | Call `store.readConsolidated('repo', repoHash)`. Return raw content or `null`. |
| `'system'` | Call `store.readConsolidated('system')`. Return raw content or `null`. |
| `'both'` | Read both repo and system consolidated. Format into the combined markdown block (see below). If only one has content, return only that section. If neither, return `null`. |

**Combined markdown format** (from `docs/designs/coc-memory.md` §1):

```markdown
## Context from Memory

### Project-Specific
{repo content}

### General Knowledge
{system content}
```

When only one source has content the output includes only the relevant `###` section under the `## Context from Memory` heading. Whitespace rules: one blank line after each heading, content trimmed, trailing newline at end.

#### `packages/pipeline-core/test/memory/memory-retriever.test.ts`

Vitest test file. Mock `MemoryStore` using `vi.fn()` — no filesystem I/O. Seven test cases (see [Tests](#tests)).

Follow the existing test patterns from `memory-store.test.ts`:
- Import from `vitest` (`describe`, `it`, `expect`, `vi`)
- Import types from `../../src/memory/types`
- Import `MemoryRetriever` from `../../src/memory/memory-retriever`
- No `beforeEach` temp-dir setup needed (all mocked)

### Files to Modify

#### `packages/pipeline-core/src/memory/index.ts`

Add one export line:

```typescript
export { MemoryRetriever } from './memory-retriever';
```

### Files to Delete

None.

## Implementation Notes

1. **`readConsolidated` contract** — returns `string | null` (see `memory-store.ts:266-277`). The retriever treats empty string the same as `null` (no content) by trimming and checking length.

2. **No `'both'` on `readConsolidated`** — `MemoryStore.readConsolidated` resolves a single directory (`system/` or `repos/<hash>/`). For `level='both'`, the retriever must make two separate calls: `readConsolidated('repo', repoHash)` and `readConsolidated('system')`.

3. **Mock shape** — only `readConsolidated` needs to be mocked. Use a partial `MemoryStore` cast:
   ```typescript
   const mockStore = {
       readConsolidated: vi.fn(),
   } as unknown as MemoryStore;
   ```

4. **No side effects** — `MemoryRetriever` is pure read-only; it never calls `writeConsolidated`, `writeRaw`, or `updateIndex`.

5. **Trim content** — both repo and system content should be `.trim()`'d before insertion to avoid double blank lines in the formatted output.

## Tests

All tests use a mocked `MemoryStore` with `vi.fn()` for `readConsolidated`.

| # | Name | Setup | Assertion |
|---|------|-------|-----------|
| 1 | Returns `null` when no memory at any level | `readConsolidated` returns `null` for all calls | `retrieve('both', hash)` → `null` |
| 2 | Returns repo-only when `level='repo'` | repo returns content, system not called | Result equals repo content string |
| 3 | Returns system-only when `level='system'` | system returns content, repo not called | Result equals system content string |
| 4 | Combined block when `level='both'` and both exist | repo + system both return content | Output matches full combined markdown format |
| 5 | Only repo section when `level='both'` but system empty | repo returns content, system returns `null` | Output has `## Context from Memory` + `### Project-Specific` only |
| 6 | Only system section when `level='both'` but repo empty | system returns content, repo returns `null` | Output has `## Context from Memory` + `### General Knowledge` only |
| 7 | Correct markdown headers in combined output | Both return content | Assert `includes('## Context from Memory')`, `includes('### Project-Specific')`, `includes('### General Knowledge')` |

## Acceptance Criteria

- [ ] `MemoryRetriever` class exported from `packages/pipeline-core/src/memory/index.ts`
- [ ] `retrieve('repo', hash)` returns raw consolidated content or `null`
- [ ] `retrieve('system')` returns raw consolidated content or `null`
- [ ] `retrieve('both', hash)` returns formatted markdown block with correct headers
- [ ] When only one level has content, output includes only that section
- [ ] When neither level has content, returns `null`
- [ ] Empty-string content treated same as `null`
- [ ] All 7 tests pass (`npm run test:run` in `packages/pipeline-core`)
- [ ] No filesystem I/O in tests (fully mocked)

## Dependencies

- `MemoryStore` interface (`packages/pipeline-core/src/memory/types.ts`) — already exists
- `FileMemoryStore.readConsolidated` (`packages/pipeline-core/src/memory/memory-store.ts:266-277`) — already implemented
- Design doc format (`docs/designs/coc-memory.md` §1 "Retrieve (Pre-Call)") — already specified

## Assumed Prior State

- `packages/pipeline-core/src/memory/types.ts` exports `MemoryStore` interface and `MemoryLevel` type
- `packages/pipeline-core/src/memory/memory-store.ts` exports `FileMemoryStore` with working `readConsolidated`
- `packages/pipeline-core/src/memory/index.ts` re-exports types and `FileMemoryStore`
- `packages/pipeline-core/test/memory/` directory exists with Vitest configuration
- `readConsolidated(level, repoHash?)` returns `string | null` — `null` means no file on disk
