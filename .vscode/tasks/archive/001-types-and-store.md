---
status: pending
---

# 001: Tool Call Cache Types & Store

## Summary

Define all data types for the tool-call caching system and implement `FileToolCallCacheStore` — the persistence layer that stores raw tool-call Q&A entries, consolidated summaries, and cache index metadata on disk. This mirrors the existing `types.ts` + `memory-store.ts` foundation of the memory system.

## Motivation

Foundation commit — every subsequent commit (aggregation, retrieval, integration) depends on these types and the store interface. Isolating the pure data layer first means the rest of the system can be built and tested against a stable contract. This follows the same layering strategy used for `FileMemoryStore`: types first, then store, then higher-level consumers.

## Changes

### Files to Create

- `packages/pipeline-core/src/memory/tool-call-cache-types.ts` — All type definitions and the `ToolCallCacheStore` interface
- `packages/pipeline-core/src/memory/tool-call-cache-store.ts` — `FileToolCallCacheStore` class implementing the interface
- `packages/pipeline-core/test/memory/tool-call-cache-store.test.ts` — Vitest tests for all CRUD operations

### Files to Modify

- `packages/pipeline-core/src/memory/index.ts` — Add barrel exports for new types and the store class

### Files to Delete

(none)

## Implementation Notes

### Type Definitions (`tool-call-cache-types.ts`)

Follow the same doc-comment style and section-separator pattern as `types.ts` (lines 1–9 header, `// ---` section separators).

#### ToolCallFilter

```ts
/**
 * Predicate to decide which tool calls should be cached.
 * Return true to cache the call, false to skip.
 */
export type ToolCallFilter = (toolName: string, args: Record<string, unknown>) => boolean;
```

#### ToolCallQAEntry

Raw Q&A entry stored as individual JSON files under `explore-cache/raw/`.

```ts
export interface ToolCallQAEntry {
    /** Unique identifier (uuid v4 or timestamp-based) */
    id: string;
    /** Name of the tool that was called (e.g. "grep", "view", "glob") */
    toolName: string;
    /** Normalized question/description derived from the tool call args */
    question: string;
    /** The tool's response/output */
    answer: string;
    /** Original arguments passed to the tool */
    args: Record<string, unknown>;
    /** Git HEAD hash at time of capture, for staleness detection */
    gitHash?: string;
    /** ISO 8601 timestamp of when this entry was captured */
    timestamp: string;
    /** ID of the parent tool call if this was a nested/chained call */
    parentToolCallId?: string;
}
```

#### ToolCallCacheIndex

Maps 1:1 to `explore-cache/index.json` on disk. Mirrors `MemoryIndex` structure (see `types.ts:59–68`).

```ts
export interface ToolCallCacheIndex {
    /** ISO 8601 timestamp of last aggregation/consolidation run */
    lastAggregation: string | null;
    /** Number of unprocessed raw Q&A files */
    rawCount: number;
    /** Number of entries in consolidated.json */
    consolidatedCount: number;
    /** Git HEAD hash at time of last aggregation */
    gitHash?: string;
}
```

#### ConsolidatedToolCallEntry

Consolidated/deduplicated entry produced by the aggregator (future commit). Stored in `explore-cache/consolidated.json` as an array.

```ts
export interface ConsolidatedToolCallEntry {
    /** Unique identifier for the consolidated entry */
    id: string;
    /** Normalized question (may be a merged/generalized form of multiple raw questions) */
    question: string;
    /** Consolidated answer (may be summarized from multiple raw answers) */
    answer: string;
    /** Topic tags for retrieval filtering (e.g. ["architecture", "testing"]) */
    topics: string[];
    /** Git hash when this entry was last updated */
    gitHash?: string;
    /** Tool names that contributed to this entry */
    toolSources: string[];
    /** ISO 8601 timestamp when this entry was first created */
    createdAt: string;
    /** Number of times this entry has been used for context injection */
    hitCount: number;
}
```

#### ToolCallCacheConfig

Configuration shape for the `toolCallCache` field in pipeline YAML or runtime options. Reuses `MemoryLevel` from `types.ts:96`.

```ts
import { MemoryLevel } from './types';

export interface ToolCallCacheConfig {
    /** Whether the cache is enabled */
    enabled: boolean;
    /** Optional filter to select which tool calls to cache */
    filter?: ToolCallFilter;
    /** Memory level to scope caching (reuse existing MemoryLevel) */
    level: MemoryLevel;
}
```

#### ToolCallCacheStoreOptions

```ts
export interface ToolCallCacheStoreOptions {
    /** Root directory for all memory data. Default: ~/.coc/memory */
    dataDir?: string;
    /** Subdirectory name under dataDir (or under repo/system dir) for cache data. Default: 'explore-cache' */
    cacheSubDir?: string;
}
```

#### ToolCallCacheStats

```ts
export interface ToolCallCacheStats {
    /** Number of raw Q&A files */
    rawCount: number;
    /** Whether consolidated.json exists */
    consolidatedExists: boolean;
    /** Number of entries in consolidated.json */
    consolidatedCount: number;
    /** ISO 8601 timestamp of last aggregation, or null */
    lastAggregation: string | null;
}
```

#### ToolCallCacheStore interface

Follows the same method grouping as `MemoryStore` (see `types.ts:148–238`): raw CRUD, consolidated, index, management. Key difference: no `level`/`repoHash` routing — the cache is always scoped to a single directory (the repo-level cache or a provided path).

```ts
export interface ToolCallCacheStore {
    // --- Raw Q&A entries ---
    writeRaw(entry: ToolCallQAEntry): Promise<string>;
    readRaw(filename: string): Promise<ToolCallQAEntry | undefined>;
    listRaw(): Promise<string[]>;
    deleteRaw(filename: string): Promise<boolean>;

    // --- Consolidated entries ---
    readConsolidated(): Promise<ConsolidatedToolCallEntry[]>;
    writeConsolidated(entries: ConsolidatedToolCallEntry[]): Promise<void>;

    // --- Index ---
    readIndex(): Promise<ToolCallCacheIndex>;
    updateIndex(updates: Partial<ToolCallCacheIndex>): Promise<void>;

    // --- Management ---
    getStats(): Promise<ToolCallCacheStats>;
    clear(): Promise<void>;
}
```

### Store Implementation (`tool-call-cache-store.ts`)

#### Imports and class structure

```ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
```

Mirror `FileMemoryStore` patterns exactly:
- **Constructor:** Accept `ToolCallCacheStoreOptions`, default `dataDir` to `path.join(os.homedir(), '.coc', 'memory')`, default `cacheSubDir` to `'explore-cache'`. Compute `this.cacheDir = path.join(dataDir, cacheSubDir)` and `this.rawDir = path.join(this.cacheDir, 'raw')`.
- **Write queue:** Private `writeQueue: Promise<void>` initialized to `Promise.resolve()`, with `enqueueWrite<T>(fn: () => Promise<T>): Promise<T>` method — exact copy of `FileMemoryStore` lines 49–56.
- **Atomic write helper:** Private `atomicWrite(filePath: string, content: string): Promise<void>` — exact copy of `FileMemoryStore` lines 257–262 (mkdir parent + write .tmp + rename).

#### Disk layout

```
<dataDir>/<cacheSubDir>/
├── raw/
│   ├── 1719849600000-grep.json    # <timestamp_ms>-<sanitized_toolName>.json
│   ├── 1719849601234-view.json
│   └── ...
├── consolidated.json              # ConsolidatedToolCallEntry[]
└── index.json                     # ToolCallCacheIndex
```

Raw files use JSON (not markdown frontmatter) because tool-call data is structured, not prose. File naming: `<Date.now()>-<sanitizedToolName>.json` — use millisecond timestamp for uniqueness (unlike the memory system's ISO timestamp which needed colons replaced).

#### Filename helpers

```ts
private sanitizeToolName(name: string): string {
    return name.replace(/[^a-zA-Z0-9\-_]/g, '_');
}

private generateRawFilename(entry: ToolCallQAEntry): string {
    const ts = new Date(entry.timestamp).getTime();
    const tool = this.sanitizeToolName(entry.toolName);
    return `${ts}-${tool}.json`;
}
```

This mirrors `FileMemoryStore.sanitizePipelineId` (line 86–88) and `generateRawFilename` (line 90–94).

#### writeRaw

```ts
async writeRaw(entry: ToolCallQAEntry): Promise<string> {
    const filename = this.generateRawFilename(entry);
    return this.enqueueWrite(async () => {
        await fs.mkdir(this.rawDir, { recursive: true });
        const filePath = path.join(this.rawDir, filename);
        const tmpPath = filePath + '.tmp';
        await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
        await fs.rename(tmpPath, filePath);
        return filename;
    });
}
```

#### readRaw

```ts
async readRaw(filename: string): Promise<ToolCallQAEntry | undefined> {
    try {
        const filePath = path.join(this.rawDir, filename);
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as ToolCallQAEntry;
    } catch {
        return undefined;
    }
}
```

#### listRaw

Return `.json` files sorted newest-first (reverse alphabetical works because timestamp prefix is numeric).

```ts
async listRaw(): Promise<string[]> {
    try {
        const files = await fs.readdir(this.rawDir);
        return files.filter(f => f.endsWith('.json')).sort().reverse();
    } catch {
        return [];
    }
}
```

#### deleteRaw

```ts
async deleteRaw(filename: string): Promise<boolean> {
    return this.enqueueWrite(async () => {
        try {
            await fs.unlink(path.join(this.rawDir, filename));
            return true;
        } catch {
            return false;
        }
    });
}
```

#### readConsolidated / writeConsolidated

```ts
async readConsolidated(): Promise<ConsolidatedToolCallEntry[]> {
    try {
        const filePath = path.join(this.cacheDir, 'consolidated.json');
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as ConsolidatedToolCallEntry[];
    } catch {
        return [];
    }
}

async writeConsolidated(entries: ConsolidatedToolCallEntry[]): Promise<void> {
    return this.enqueueWrite(async () => {
        const filePath = path.join(this.cacheDir, 'consolidated.json');
        await this.atomicWrite(filePath, JSON.stringify(entries, null, 2));
    });
}
```

Note: `readConsolidated` returns `[]` (not `null`) on missing file — arrays are easier to consume without null checks. This differs from `FileMemoryStore.readConsolidated` which returns `string | null` because it deals with free-form markdown.

#### readIndex / updateIndex

Follow `FileMemoryStore` lines 293–319 exactly. Default index:

```ts
private static DEFAULT_INDEX: ToolCallCacheIndex = {
    lastAggregation: null,
    rawCount: 0,
    consolidatedCount: 0,
};
```

`updateIndex` does a read-merge-write inside `enqueueWrite`, same as `FileMemoryStore.updateIndex`.

#### getStats

```ts
async getStats(): Promise<ToolCallCacheStats> {
    let rawCount = 0;
    try {
        const entries = await fs.readdir(this.rawDir);
        rawCount = entries.filter(e => e.endsWith('.json')).length;
    } catch { /* dir may not exist */ }

    let consolidatedExists = false;
    let consolidatedCount = 0;
    try {
        const data = await fs.readFile(path.join(this.cacheDir, 'consolidated.json'), 'utf-8');
        consolidatedExists = true;
        consolidatedCount = (JSON.parse(data) as unknown[]).length;
    } catch { /* file may not exist */ }

    const index = await this.readIndex();

    return {
        rawCount,
        consolidatedExists,
        consolidatedCount,
        lastAggregation: index.lastAggregation,
    };
}
```

#### clear

```ts
async clear(): Promise<void> {
    return this.enqueueWrite(async () => {
        try {
            await fs.rm(this.cacheDir, { recursive: true, force: true });
        } catch { /* dir may not exist */ }
    });
}
```

#### Path accessor

Expose `getCacheDir(): string` for tests and diagnostics.

### Barrel Exports (`index.ts` modification)

Append to existing exports in `packages/pipeline-core/src/memory/index.ts`:

```ts
// Tool call cache
export type {
    ToolCallFilter,
    ToolCallQAEntry,
    ToolCallCacheIndex,
    ConsolidatedToolCallEntry,
    ToolCallCacheConfig,
    ToolCallCacheStoreOptions,
    ToolCallCacheStats,
    ToolCallCacheStore,
} from './tool-call-cache-types';

export { FileToolCallCacheStore } from './tool-call-cache-store';
```

### Key Design Decisions

1. **JSON not Markdown** — Raw entries are JSON files, not markdown with YAML frontmatter. Tool call data is structured (args dict, metadata fields) and will be consumed programmatically, not read by humans. JSON parse/write is simpler and faster than frontmatter serialization.

2. **No level/repoHash routing** — Unlike `MemoryStore` which routes to `system/` or `repos/<hash>/`, the cache store operates on a single directory. Callers (the future integration layer) will instantiate separate stores for different scopes or compose the `cacheSubDir` to include a repo hash.

3. **Millisecond timestamps in filenames** — Use `Date.now()` (e.g., `1719849600000`) instead of ISO 8601 (e.g., `2026-02-28T15-00-00.000Z`). Simpler, no colon-replacement needed, sorts correctly as strings.

4. **`readConsolidated` returns `[]` not `null`** — Array return type avoids null checks in every consumer. Empty array semantically means "no cached knowledge yet."

5. **Write queue serialization** — Copy the `enqueueWrite` pattern from `FileMemoryStore` verbatim to prevent concurrent write corruption. This is the same promise-chain approach used throughout the codebase.

## Tests

Test file: `packages/pipeline-core/test/memory/tool-call-cache-store.test.ts`

Follow the existing test patterns from `memory-store.test.ts`:
- `beforeEach`: create temp dir with `fs.mkdtemp(path.join(os.tmpdir(), 'tool-call-cache-test-'))`
- `afterEach`: cleanup with `fs.rm(tmpDir, { recursive: true, force: true })`
- Instantiate store with `new FileToolCallCacheStore({ dataDir: tmpDir })`

### Helper factory

```ts
function makeEntry(overrides?: Partial<ToolCallQAEntry>): ToolCallQAEntry {
    return {
        id: 'test-id-' + Date.now(),
        toolName: 'grep',
        question: 'Find all uses of MemoryStore',
        answer: 'Found 5 files...',
        args: { pattern: 'MemoryStore', path: 'src/' },
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}
```

### Test cases

- **writeRaw/readRaw roundtrip** — Write an entry, read it back, verify all fields match including `args` deep equality
- **writeRaw returns a .json filename** — Verify filename ends with `.json` and contains the tool name
- **readRaw returns undefined for non-existent file** — Verify graceful miss
- **listRaw returns files sorted newest-first** — Write 3 entries with different timestamps, verify order
- **listRaw returns empty array for empty store** — No errors on missing directory
- **deleteRaw removes file and returns true** — Write then delete, verify gone from listing
- **deleteRaw returns false for non-existent file** — Verify graceful miss
- **Concurrent write serialization** — Fire 10 parallel `writeRaw` calls, verify all 10 files exist and are parseable (mirrors `memory-store.test.ts` lines 278–300)
- **readConsolidated returns empty array when no file** — Verify `[]` default
- **writeConsolidated/readConsolidated roundtrip** — Write array of entries, read back, verify deep equality
- **writeConsolidated overwrites existing** — Write twice, verify only latest data
- **writeConsolidated leaves no .tmp file** — Verify atomic write cleanup (mirrors `memory-store-consolidated.test.ts` line 56–61)
- **readIndex returns defaults when no file** — Verify `{ lastAggregation: null, rawCount: 0, consolidatedCount: 0 }`
- **updateIndex creates index.json** — Update one field, verify others are defaults
- **updateIndex merges partial updates** — Update twice with different fields, verify merge
- **getStats accuracy** — Write some raw entries and consolidated, verify counts match
- **getStats returns zeros for empty store** — Verify clean initial state
- **clear() removes all data** — Write raw + consolidated + index, clear, verify all gone
- **clear() on non-existent directory** — No errors
- **File naming sanitization** — Entry with `toolName: 'my/tool:v2'` produces filename without `/` or `:`
- **getCacheDir returns correct path** — Verify default and custom `cacheSubDir`
- **Default dataDir** — Verify `new FileToolCallCacheStore()` (no options) points to `~/.coc/memory/explore-cache`

## Acceptance Criteria

- [ ] All types exported from `packages/pipeline-core/src/memory/index.ts`
- [ ] `FileToolCallCacheStore` implements `ToolCallCacheStore` interface completely
- [ ] All CRUD tests pass with real temp directories (no mocks for fs)
- [ ] Atomic write safety: no `.tmp` files left after writes
- [ ] Concurrent write serialization: 10 parallel writes all succeed without corruption
- [ ] `clear()` removes entire cache directory without errors
- [ ] `getStats()` counts match actual filesystem state
- [ ] No dependencies on AI SDK, VS Code, or any external services — pure data layer
- [ ] File naming sanitization prevents filesystem-unsafe characters
- [ ] `npm run build` succeeds with new files
- [ ] `vitest` tests in `packages/pipeline-core` all pass (existing + new)

## Dependencies

- Depends on: None

## Assumed Prior State

None — first commit. The `packages/pipeline-core/src/memory/` directory already contains `types.ts`, `memory-store.ts`, and `index.ts` which define the patterns to follow.
