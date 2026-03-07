# Hierarchical Explore Cache Storage

## Problem

The tool-call cache (`explore-cache/`) stores all consolidated entries as a single `consolidated.json` file. This file contains the full payload (including potentially large `answer` fields) for every entry. As the cache grows:

1. **Memory pressure** — The retriever (`ToolCallCacheRetriever`) lazy-loads the entire file into memory, even though lookups only need `question` + metadata for similarity scoring.
2. **I/O amplification** — Every `incrementHitCount()` call rewrites the entire file. Every aggregation rewrites all entries.
3. **Scalability ceiling** — A single JSON file with large answer payloads will eventually hit parsing/serialization bottlenecks.

## Proposed Approach

Split `consolidated.json` into a **lightweight index** + **individual answer files**:

```
explore-cache/
  raw/                          ← unchanged
  consolidated/
    index.json                  ← array of ConsolidatedIndexEntry (no answer field)
    entries/
      <entry-id>.md             ← full answer as markdown
  index.json                    ← ToolCallCacheIndex (unchanged)
```

- `consolidated/index.json` contains all metadata fields (`id`, `question`, `topics`, `gitHash`, `toolSources`, `createdAt`, `hitCount`) but **NOT** the `answer`.
- `consolidated/entries/<id>.md` contains the answer payload as a markdown file, named by the entry's `id`.
- The retriever loads only the index for similarity scoring. The `answer` is loaded on-demand only when a match is found.

## Affected Files

| File | Changes |
|------|---------|
| `packages/pipeline-core/src/memory/tool-call-cache-types.ts` | Add `ConsolidatedIndexEntry` type (sans `answer`), update `ToolCallCacheStore` interface |
| `packages/pipeline-core/src/memory/tool-call-cache-store.ts` | Rewrite `readConsolidated`/`writeConsolidated` for hierarchical layout, add `readEntryAnswer(id)` |
| `packages/pipeline-core/src/memory/tool-call-cache-retriever.ts` | Load index-only for scoring; lazy-load answer on match |
| `packages/pipeline-core/src/memory/tool-call-cache-aggregator.ts` | Update `aggregate()` to write index + individual answer files |
| `packages/pipeline-core/test/memory/tool-call-cache-store.test.ts` | Update tests for new file layout |
| `packages/pipeline-core/test/memory/tool-call-cache-retriever.test.ts` | Update tests for lazy answer loading |
| `packages/pipeline-core/test/memory/tool-call-cache-aggregator.test.ts` | Update tests for hierarchical write |
| `packages/coc-server/src/memory/tool-call-aggregation-handler.ts` | No changes expected (uses store interface) |
| `packages/coc-server/test/tool-call-aggregation-handler.test.ts` | May need minor updates if mock shape changes |

## Detailed Tasks

### 1. Add `ConsolidatedIndexEntry` type and update store interface
**File:** `tool-call-cache-types.ts` ✅

- Create `ConsolidatedIndexEntry` — identical to `ConsolidatedToolCallEntry` but with `answer` omitted:
  ```ts
  export type ConsolidatedIndexEntry = Omit<ConsolidatedToolCallEntry, 'answer'>;
  ```
- Add new methods to `ToolCallCacheStore` interface:
  ```ts
  readConsolidatedIndex(): Promise<ConsolidatedIndexEntry[]>;
  readEntryAnswer(id: string): Promise<string | undefined>;
  writeConsolidatedEntry(entry: ConsolidatedToolCallEntry): Promise<void>;
  deleteConsolidatedEntry(id: string): Promise<boolean>;
  ```
- Keep existing `readConsolidated()` and `writeConsolidated()` for backward compatibility during migration, but mark them as performing the full reassembly.

### 2. Implement hierarchical storage in `FileToolCallCacheStore`
**File:** `tool-call-cache-store.ts` ✅

- Add path helpers:
  ```ts
  private get consolidatedDir(): string   // → cacheDir/consolidated
  private get entriesDir(): string        // → cacheDir/consolidated/entries
  private get consolidatedIndexPath(): string // → cacheDir/consolidated/index.json
  ```
- **`writeConsolidated(entries)`** — rewrite to:
  1. Write each entry's `answer` to `consolidated/entries/<id>.md` (atomic write)
  2. Strip `answer` from each entry, write array to `consolidated/index.json` (atomic write)
  3. Clean up orphaned `.md` files not in the new entry set
- **`readConsolidated()`** — reassemble full entries by reading index + each answer file (backward compat)
- **`readConsolidatedIndex()`** — read only `consolidated/index.json`
- **`readEntryAnswer(id)`** — read `consolidated/entries/<id>.md`, return undefined if missing
- **`writeConsolidatedEntry(entry)`** — write a single entry (update index + answer file)
- **`deleteConsolidatedEntry(id)`** — remove from index + delete answer file
- **Migration**: If old-format `consolidated.json` exists at `cacheDir/consolidated.json`, auto-migrate on first read:
  1. Read old file
  2. Write in new hierarchical format
  3. Delete old `consolidated.json`
- **`getStats()`** — update to look in `consolidated/index.json` instead of `consolidated.json`

### 3. Update retriever for lazy answer loading
**File:** `tool-call-cache-retriever.ts` ✅

- Change `loadConsolidated()` to call `store.readConsolidatedIndex()` — returns entries without answers
- In `lookup()`, after finding best match, call `store.readEntryAnswer(bestEntry.id)` to get the actual answer
- Update `ToolCallCacheLookupResult.entry` to include the full `ConsolidatedToolCallEntry` (with answer populated)
- `incrementHitCount()` — update only the index file (no answer rewrite needed), use `writeConsolidatedEntry` or a new targeted index-update method

### 4. Update aggregator for hierarchical write
**File:** `tool-call-cache-aggregator.ts` ✅

- `aggregate()` — after parsing AI response, call `store.writeConsolidated(consolidated)` as before (the store now handles splitting internally)
- No prompt changes needed — the AI still returns full `ConsolidatedToolCallEntry[]` objects
- The aggregator remains unaware of the storage layout (good separation)

### 5. Update tests ✅
- **Store tests**: Verify new file layout on disk (`consolidated/index.json`, `consolidated/entries/*.md`), migration from old format, orphan cleanup
- **Retriever tests**: Verify answers are loaded lazily, lookup returns full entry with answer
- **Aggregator tests**: Verify end-to-end aggregation produces correct hierarchical files
- **Server handler tests**: Verify no regressions

### 6. Migration support ✅
- Auto-detect old `consolidated.json` at the cache root and migrate on first access
- Migration is idempotent — if both old and new formats exist, prefer new
- Log migration events for observability

## Design Decisions

1. **Markdown for answers** — Answers are already text/markdown-like content. Using `.md` makes them human-readable and git-friendly.
2. **ID-based filenames** — IDs are AI-generated kebab-case strings (e.g., `architecture-overview`), which are filesystem-safe. Add sanitization as a safety net.
3. **Keep `writeConsolidated(entries[])` as the primary write API** — The store handles splitting internally, keeping aggregator simple.
4. **Orphan cleanup on write** — When writing a new consolidated set, remove answer files for IDs no longer in the index to prevent disk leaks.
5. **Backward-compatible `readConsolidated()`** — Still returns full `ConsolidatedToolCallEntry[]` by reassembling index + answers. New callers use the index-only API.

## Out of Scope

- Changing the raw Q&A entry storage (already individual files)
- Changing the aggregation AI prompt or consolidation logic
- Adding pagination or streaming for very large caches
- Changing the REST API response format (server handler just calls store methods)
