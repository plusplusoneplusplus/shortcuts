---
status: done
---

# 003: Tool Call Cache Aggregation

## Summary

`ToolCallCacheAggregator` consolidates raw Q&A cache entries into a searchable `consolidated.json` index via AI-powered deduplication, clustering, and normalization. It mirrors `MemoryAggregator`'s safety-first pattern (write consolidated FIRST, delete raw AFTER) and depends only on the `ToolCallCacheStore` from commit 001.

## Motivation

Aggregation is the bridge between raw capture and efficient retrieval. Without it, retrieval (004) would have to scan every individual raw file. By clustering, deduplicating, and normalizing entries, we produce a compact consolidated index that enables fast topic-based and question-based lookup. This commit is isolated because it has a single dependency (001's store) and produces a single artifact (`consolidated.json`), making it independently testable.

## Changes

### Files to Create

- `packages/pipeline-core/src/memory/tool-call-cache-aggregator.ts` — `ToolCallCacheAggregator` class with threshold-gated and forced aggregation methods
- `packages/pipeline-core/test/memory/tool-call-cache-aggregator.test.ts` — Vitest suite covering all aggregation paths

### Files to Modify

(none expected)

### Files to Delete

(none)

## Implementation Notes

### Class Structure

```typescript
import { ToolCallCacheStore, ConsolidatedToolCallEntry, ToolCallCacheIndex } from './tool-call-cache-types';
import { AIInvoker } from '../map-reduce/types';
import { MemoryLevel } from './types';

export interface ToolCallCacheAggregatorOptions {
    /** Minimum raw entry count before automatic aggregation triggers. Default: 5 */
    batchThreshold?: number;
}

export class ToolCallCacheAggregator {
    private readonly store: ToolCallCacheStore;
    private readonly batchThreshold: number;

    constructor(store: ToolCallCacheStore, options?: ToolCallCacheAggregatorOptions) {
        this.store = store;
        this.batchThreshold = options?.batchThreshold ?? 5;
    }

    async aggregateIfNeeded(aiInvoker: AIInvoker, level: MemoryLevel, repoHash?: string): Promise<boolean>;
    async aggregate(aiInvoker: AIInvoker, level: MemoryLevel, repoHash?: string): Promise<void>;
}
```

### Pattern: Mirror MemoryAggregator exactly

The existing `MemoryAggregator` (at `packages/pipeline-core/src/memory/memory-aggregator.ts`) establishes these invariants that MUST be preserved:

1. **`aggregateIfNeeded` handles `level === 'both'`** by recursing into `'system'` and `'repo'` separately (lines 41-44).
2. **Threshold check** compares `listRaw().length` against `batchThreshold` (line 48). Returns `false` early if under threshold.
3. **`aggregate` handles `level === 'both'`** the same way (lines 65-69).
4. **No-op on zero raw entries** (lines 72-75).
5. **Safety ordering**: write consolidated → update index → delete raw files. Raw files are ONLY deleted after consolidated write succeeds.
6. **AI failure propagation**: if `result.success === false`, throw an error. This ensures raw entries are never deleted on failure (since the throw exits before deletion).

### Aggregation Pipeline (8 steps)

Following `MemoryAggregator` line-for-line:

```
Step 1: List raw entry IDs          → store.listRawEntries(level, repoHash)
Step 2: Early exit if empty         → return if length === 0
Step 3: Read all raw entries        → Promise.all(ids.map(id => store.readRawEntry(level, repoHash, id)))
Step 4: Read existing consolidated  → store.readConsolidated(level, repoHash)
Step 5: Build AI prompt             → this.buildPrompt(existing, rawEntries)
Step 6: Call AI                     → aiInvoker(prompt)
Step 7: Parse AI response           → this.parseConsolidatedResponse(result.response!)
Step 8: Write consolidated.json     → store.writeConsolidated(level, parsed, repoHash)  ← MUST SUCCEED
Step 9: Update index.json           → store.updateIndex(level, repoHash, { ... })
Step 10: Delete raw entries         → for (const id of ids) store.deleteRawEntry(level, repoHash, id)
```

Note: MemoryAggregator uses 8 steps (steps 1+2 combined, etc.). The tool-call cache version adds a `parseConsolidatedResponse` step because output is structured JSON, not free-form markdown.

### AI Prompt Template

The prompt is the most critical piece. It must produce valid `ConsolidatedToolCallEntry[]` JSON:

```typescript
private buildPrompt(
    existing: ConsolidatedToolCallEntry[] | null,
    rawEntries: RawToolCallEntry[],
): string {
    const existingSection = existing
        ? JSON.stringify(existing, null, 2)
        : 'No existing consolidated entries';

    const rawSection = rawEntries
        .map(e => JSON.stringify({ question: e.question, answer: e.answer, toolSources: e.toolSources, gitHash: e.gitHash }, null, 2))
        .join('\n\n');

    return [
        'You are a tool-call cache consolidator. Your job is to merge raw Q&A pairs into a deduplicated, clustered, normalized index.',
        '',
        '## Existing Consolidated Entries',
        existingSection,
        '',
        `## New Raw Entries (${rawEntries.length} entries)`,
        rawSection,
        '',
        '## Instructions',
        '1. **Deduplicate**: Merge entries with near-identical questions (e.g. "list files in src" vs "list files in the src directory"). Keep the best answer.',
        '2. **Cluster by topic**: Assign 1-3 topic tags per entry (e.g. ["file-structure", "git"], ["testing", "vitest"]).',
        '3. **Normalize questions**: Rewrite questions to be generic and reusable. Remove repo-specific paths where possible, but preserve the semantic intent.',
        '4. **Preserve tool sources**: Union all toolSources from merged entries.',
        '5. **Set confidence**: 1.0 for entries with consistent answers, lower for entries with conflicting answers.',
        '6. **Merge with existing**: If an existing consolidated entry covers the same question, update its answer and increment hitCount.',
        '7. **Prune**: Drop entries that appear trivial or overly specific to a single context.',
        '',
        '## Output Format',
        'Respond with ONLY a JSON array of consolidated entries. No markdown fences, no explanation.',
        'Each entry must have this exact shape:',
        '```',
        '{',
        '  "id": "<unique-kebab-case-id>",',
        '  "question": "<normalized question>",',
        '  "answer": "<best answer>",',
        '  "topics": ["<topic1>", "<topic2>"],',
        '  "gitHash": "<most-recent-git-hash-or-null>",',
        '  "toolSources": ["<tool1>", "<tool2>"],',
        '  "createdAt": "<ISO-8601>",',
        '  "hitCount": <number>',
        '}',
        '```',
    ].join('\n');
}
```

### JSON Parsing Strategy

The AI response must be parsed into `ConsolidatedToolCallEntry[]`. Use a defensive approach:

```typescript
private parseConsolidatedResponse(response: string): ConsolidatedToolCallEntry[] {
    // 1. Strip markdown code fences if present (AI may add them despite instructions)
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    // 2. Parse JSON
    const parsed = JSON.parse(cleaned);

    // 3. Validate array
    if (!Array.isArray(parsed)) {
        throw new Error('AI response is not a JSON array');
    }

    // 4. Validate each entry has required fields
    return parsed.map((entry: Record<string, unknown>) => ({
        id: String(entry.id ?? crypto.randomUUID()),
        question: String(entry.question ?? ''),
        answer: String(entry.answer ?? ''),
        topics: Array.isArray(entry.topics) ? entry.topics.map(String) : [],
        gitHash: entry.gitHash ? String(entry.gitHash) : null,
        toolSources: Array.isArray(entry.toolSources) ? entry.toolSources.map(String) : [],
        createdAt: String(entry.createdAt ?? new Date().toISOString()),
        hitCount: typeof entry.hitCount === 'number' ? entry.hitCount : 1,
    }));
}
```

Key decisions:
- **Strip code fences**: AI models frequently wrap JSON in ` ```json ` blocks despite being told not to.
- **Coerce fields with defaults**: Rather than rejecting malformed entries, coerce them. Missing `id` gets a UUID, missing `topics` becomes `[]`, etc.
- **`JSON.parse` failure propagates**: If the response is not parseable JSON at all, the error propagates up and the raw entries are preserved (same safety pattern as `MemoryAggregator` throwing on AI failure).

### Error Handling

Following `MemoryAggregator` lines 90-93:

```typescript
// AI call failure
const result = await aiInvoker(prompt);
if (!result.success) {
    throw new Error(`Tool call cache aggregation failed: ${result.error ?? 'unknown error'}`);
}

// JSON parse failure — also throws, preventing raw deletion
const consolidated = this.parseConsolidatedResponse(result.response!);
```

Both AI failure AND JSON parse failure throw before the write step, so raw entries are always preserved on any error. This is the critical safety invariant.

### Index Update

After successful write, update the tool-call cache index:

```typescript
await this.store.updateIndex(level, repoHash, {
    lastAggregation: new Date().toISOString(),
    rawCount: 0,
    consolidatedCount: consolidated.length,
    topics: [...new Set(consolidated.flatMap(e => e.topics))],
});
```

The `topics` field in the index is a union of all topic tags from consolidated entries, providing a quick lookup for retrieval (004) to know what topics are available without reading the full consolidated file.

### `level === 'both'` Handling

Exactly mirrors `MemoryAggregator`:

```typescript
async aggregateIfNeeded(aiInvoker: AIInvoker, level: MemoryLevel, repoHash?: string): Promise<boolean> {
    if (level === 'both') {
        const ranSystem = await this.aggregateIfNeeded(aiInvoker, 'system');
        const ranRepo = await this.aggregateIfNeeded(aiInvoker, 'repo', repoHash);
        return ranSystem || ranRepo;
    }
    // ... threshold check and aggregate call
}

async aggregate(aiInvoker: AIInvoker, level: MemoryLevel, repoHash?: string): Promise<void> {
    if (level === 'both') {
        await this.aggregate(aiInvoker, 'system');
        await this.aggregate(aiInvoker, 'repo', repoHash);
        return;
    }
    // ... aggregation pipeline
}
```

### Store Methods Assumed (from 001)

The aggregator calls these `ToolCallCacheStore` methods:

| Method | Signature | Purpose |
|--------|-----------|---------|
| `listRawEntries` | `(level, repoHash?) → Promise<string[]>` | List raw entry IDs |
| `readRawEntry` | `(level, repoHash?, id) → Promise<RawToolCallEntry \| undefined>` | Read a single raw entry |
| `readConsolidated` | `(level, repoHash?) → Promise<ConsolidatedToolCallEntry[] \| null>` | Read consolidated.json |
| `writeConsolidated` | `(level, entries, repoHash?) → Promise<void>` | Write consolidated.json atomically |
| `deleteRawEntry` | `(level, repoHash?, id) → Promise<boolean>` | Delete a single raw entry |
| `updateIndex` | `(level, repoHash?, updates) → Promise<void>` | Update index.json |

**Key difference from MemoryStore**: `readConsolidated` returns `ConsolidatedToolCallEntry[] | null` (structured JSON) instead of `string | null` (free-form markdown). The store handles JSON serialization/deserialization. Similarly, `writeConsolidated` takes `ConsolidatedToolCallEntry[]` instead of a raw string.

## Tests

Test file: `packages/pipeline-core/test/memory/tool-call-cache-aggregator.test.ts`

Following the exact mock patterns from `memory-aggregator.test.ts` (mock store factory, mock AI invoker factory, `beforeEach` reset):

### Mock Factories

```typescript
function createMockStore(): ToolCallCacheStore {
    return {
        listRawEntries: vi.fn().mockResolvedValue([]),
        readRawEntry: vi.fn().mockResolvedValue(undefined),
        writeRawEntry: vi.fn().mockResolvedValue(''),
        deleteRawEntry: vi.fn().mockResolvedValue(true),
        readConsolidated: vi.fn().mockResolvedValue(null),
        writeConsolidated: vi.fn().mockResolvedValue(undefined),
        readIndex: vi.fn().mockResolvedValue({ lastAggregation: null, rawCount: 0, consolidatedCount: 0, topics: [] }),
        updateIndex: vi.fn().mockResolvedValue(undefined),
        // ... other store methods as no-ops
    } as unknown as ToolCallCacheStore;
}

function createMockAIInvoker(response?: string): AIInvoker {
    const defaultResponse = JSON.stringify([
        { id: 'test-1', question: 'How to X?', answer: 'Do Y.', topics: ['general'], gitHash: null, toolSources: ['grep'], createdAt: '2025-01-01T00:00:00Z', hitCount: 1 },
    ]);
    return vi.fn().mockResolvedValue({ success: true, response: response ?? defaultResponse });
}
```

### Test Cases

1. **`aggregateIfNeeded` skips when under threshold**
   - Mock `listRawEntries` → return 3 IDs (below default threshold of 5)
   - Assert returns `false`, AI never called

2. **`aggregateIfNeeded` triggers when at threshold**
   - Mock `listRawEntries` → return 5 IDs
   - Mock `readRawEntry` → return entries for each ID
   - Assert returns `true`, AI called once, `writeConsolidated` called, `deleteRawEntry` called 5×

3. **Custom `batchThreshold` is respected**
   - Create aggregator with `{ batchThreshold: 2 }`
   - Mock `listRawEntries` → return 2 IDs
   - Assert aggregation triggers

4. **`aggregate` reads raw entries and calls AI**
   - Mock 2 raw entries
   - Assert `readRawEntry` called for each
   - Assert AI prompt contains both entries' questions/answers
   - Assert prompt contains `## New Raw Entries (2 entries)`

5. **`aggregate` includes existing consolidated in prompt**
   - Mock `readConsolidated` → return array of existing entries
   - Assert AI prompt contains the JSON of existing entries

6. **`aggregate` uses fallback text when no consolidated exists**
   - Mock `readConsolidated` → return `null`
   - Assert AI prompt contains `'No existing consolidated entries'`

7. **`aggregate` writes parsed AI response as consolidated.json**
   - Mock AI response → valid JSON array
   - Assert `writeConsolidated` called with parsed `ConsolidatedToolCallEntry[]`

8. **`aggregate` handles AI response with markdown fences**
   - Mock AI response → `` ```json\n[...]\n``` ``
   - Assert consolidated still written correctly (fences stripped)

9. **`aggregate` updates index with correct metadata**
   - Assert `updateIndex` called with `rawCount: 0`, `consolidatedCount` matching entry count, `topics` union, valid ISO `lastAggregation`

10. **`aggregate` deletes raw entries AFTER successful write**
    - Assert call order: `writeConsolidated` before `deleteRawEntry`
    - Use `vi.mocked(...).mock.invocationCallOrder` to verify ordering

11. **`aggregate` preserves raw entries on AI failure**
    - Mock AI → `{ success: false, error: 'unavailable' }`
    - Assert throws with error message
    - Assert `deleteRawEntry` NOT called, `writeConsolidated` NOT called

12. **`aggregate` preserves raw entries on JSON parse failure**
    - Mock AI → `{ success: true, response: 'not json at all' }`
    - Assert throws (JSON parse error)
    - Assert `deleteRawEntry` NOT called

13. **`aggregate` merges with existing consolidated entries**
    - Mock existing consolidated with 2 entries
    - Mock AI response with 3 entries (including an update to one existing)
    - Assert `writeConsolidated` receives the 3 merged entries

14. **`level === 'both'` runs system and repo independently**
    - Mirror the exact pattern from `memory-aggregator.test.ts` lines 209-249
    - Assert AI called 2×, `writeConsolidated` called for both levels

15. **Empty raw list is a no-op**
    - Mock `listRawEntries` → `[]`
    - Assert AI not called, no writes, no deletes

## Acceptance Criteria

- [ ] `ToolCallCacheAggregator` class created with `aggregateIfNeeded` and `aggregate` methods
- [ ] Mirrors `MemoryAggregator`'s safety pattern: write consolidated FIRST, then delete raw entries
- [ ] AI prompt produces valid `ConsolidatedToolCallEntry[]` JSON
- [ ] JSON parsing is defensive: strips code fences, coerces fields with defaults
- [ ] AI failure → throws error, raw entries preserved
- [ ] JSON parse failure → throws error, raw entries preserved
- [ ] `level === 'both'` handled by recursion into `'system'` and `'repo'`
- [ ] `aggregateIfNeeded` respects configurable `batchThreshold` (default: 5)
- [ ] No-op on zero raw entries
- [ ] Index updated with `lastAggregation`, `rawCount: 0`, `consolidatedCount`, `topics` union
- [ ] All 15 test cases pass
- [ ] No VS Code dependencies — pure Node.js

## Dependencies

- Depends on: **001** (Tool Call Cache Types & Store — provides `ToolCallCacheStore`, `ConsolidatedToolCallEntry`, `RawToolCallEntry`, `ToolCallCacheIndex`)
- Does NOT depend on: 002 (Capture), 004 (Retrieval)
- Uses: `AIInvoker` from `packages/pipeline-core/src/map-reduce/types.ts`
- Uses: `MemoryLevel` from `packages/pipeline-core/src/memory/types.ts`

## Assumed Prior State

From commit 001, the following types and store exist:

### Types (`tool-call-cache-types.ts`)

```typescript
interface RawToolCallEntry {
    id: string;
    question: string;
    answer: string;
    toolSources: string[];
    gitHash: string | null;
    createdAt: string;
}

interface ConsolidatedToolCallEntry {
    id: string;
    question: string;
    answer: string;
    topics: string[];
    gitHash: string | null;
    toolSources: string[];
    createdAt: string;
    hitCount: number;
}

interface ToolCallCacheIndex {
    lastAggregation: string | null;
    rawCount: number;
    consolidatedCount: number;
    topics: string[];
}
```

### Store (`ToolCallCacheStore` interface)

```typescript
interface ToolCallCacheStore {
    listRawEntries(level: MemoryLevel, repoHash?: string): Promise<string[]>;
    readRawEntry(level: MemoryLevel, repoHash: string | undefined, id: string): Promise<RawToolCallEntry | undefined>;
    writeRawEntry(level: MemoryLevel, repoHash: string | undefined, entry: RawToolCallEntry): Promise<string>;
    deleteRawEntry(level: MemoryLevel, repoHash: string | undefined, id: string): Promise<boolean>;
    readConsolidated(level: MemoryLevel, repoHash?: string): Promise<ConsolidatedToolCallEntry[] | null>;
    writeConsolidated(level: MemoryLevel, entries: ConsolidatedToolCallEntry[], repoHash?: string): Promise<void>;
    readIndex(level: MemoryLevel, repoHash?: string): Promise<ToolCallCacheIndex>;
    updateIndex(level: MemoryLevel, repoHash: string | undefined, updates: Partial<ToolCallCacheIndex>): Promise<void>;
}
```

### Storage Layout

```
~/.coc/memory/
├── system/
│   ├── tool-call-cache/
│   │   ├── raw/           ← individual JSON files per Q&A entry
│   │   ├── consolidated.json  ← ConsolidatedToolCallEntry[]
│   │   └── index.json     ← ToolCallCacheIndex
│   ├── raw/               ← existing memory raw observations
│   └── consolidated.md    ← existing memory consolidated
└── repos/<hash>/
    ├── tool-call-cache/
    │   ├── raw/
    │   ├── consolidated.json
    │   └── index.json
    └── ...
```
