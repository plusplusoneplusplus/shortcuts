---
status: pending
---

# 004: Tool Call Cache Retrieval & Staleness

## Summary

Implement `ToolCallCacheRetriever` — the value-delivery layer that looks up cached explore answers using keyword-based Jaccard similarity and returns them with staleness metadata derived from git hash comparison. Pure algorithmic matching (no AI dependency) with configurable staleness strategies.

## Motivation

Retrieval is the layer that actually saves tokens and time: when a user asks a question that was already answered, the retriever returns the cached answer instead of re-running expensive tool calls. It must be a separate commit because it has a distinct responsibility (read path) versus the store (persistence) and aggregator (write path), and it depends on both — specifically the `consolidated.json` structure produced by the aggregator (003). Staleness detection is bundled here because it's a retrieval-time concern: deciding whether a cached answer is still trustworthy based on whether the repo has changed since the answer was captured.

## Changes

### Files to Create

- `packages/pipeline-core/src/memory/tool-call-cache-retriever.ts` — `ToolCallCacheRetriever` class with `lookup()` and `incrementHitCount()` methods
- `packages/pipeline-core/test/memory/tool-call-cache-retriever.test.ts` — Vitest test suite

### Files to Modify

- `packages/pipeline-core/src/memory/tool-call-cache-types.ts` — Add `ToolCallCacheLookupResult` type and `StalenessStrategy` type
- `packages/pipeline-core/src/memory/index.ts` — Add barrel exports for `ToolCallCacheRetriever` and new types

### Files to Delete

(none)

## Implementation Notes

### Type Additions (`tool-call-cache-types.ts`)

```typescript
/** Strategy for handling stale cache entries */
export type StalenessStrategy = 'skip' | 'warn' | 'revalidate';

/** Result of a cache lookup — returned by ToolCallCacheRetriever.lookup() */
export interface ToolCallCacheLookupResult {
    /** The matched consolidated entry */
    entry: ConsolidatedToolCallEntry;
    /** Similarity score between 0 and 1 */
    score: number;
    /** Whether the entry is stale (gitHash mismatch) */
    stale: boolean;
}
```

### Retriever Class (`tool-call-cache-retriever.ts`)

#### Constructor

```typescript
export interface ToolCallCacheRetrieverOptions {
    /** How to handle stale entries. Default: 'warn' */
    stalenessStrategy?: StalenessStrategy;
    /** Minimum Jaccard similarity score to consider a match. Default: 0.4 */
    similarityThreshold?: number;
}

export class ToolCallCacheRetriever {
    private readonly store: ToolCallCacheStore;
    private readonly stalenessStrategy: StalenessStrategy;
    private readonly similarityThreshold: number;
    private consolidatedCache: ConsolidatedToolCallEntry[] | null = null;

    constructor(store: ToolCallCacheStore, options?: ToolCallCacheRetrieverOptions) {
        this.store = store;
        this.stalenessStrategy = options?.stalenessStrategy ?? 'warn';
        this.similarityThreshold = options?.similarityThreshold ?? 0.4;
    }
}
```

**Pattern reference:** Follows the same constructor injection pattern as `MemoryRetriever` (`memory-retriever.ts:8`) and `MemoryAggregator` (`memory-aggregator.ts:18-23`) — store is injected, options provide behavioral tuning.

#### `lookup(question: string, currentGitHash?: string): Promise<ToolCallCacheLookupResult | null>`

Flow:

1. **Load consolidated entries** — call `this.loadConsolidated()` which reads `consolidated.json` from the store via `store.readConsolidated()` (analogous to `MemoryRetriever.readAndNormalize()` at `memory-retriever.ts:39-46`, but parsing JSON instead of markdown). Cache the parsed array in `this.consolidatedCache` for the lifetime of the retriever instance.

2. **Early exit** — if the array is empty or null, return `null`.

3. **Score all entries** — for each `ConsolidatedToolCallEntry`, compute Jaccard similarity between the tokenized question and the entry's `question` field:
   ```
   score = jaccardSimilarity(tokenize(question), tokenize(entry.question))
   ```

4. **Find best match** — select the entry with the highest score. If the best score is below `this.similarityThreshold`, return `null`.

5. **Check staleness** — compare `entry.gitHash` against `currentGitHash`:
   - If `currentGitHash` is undefined, treat as not stale (can't determine)
   - If `entry.gitHash` is undefined, treat as stale (unknown provenance)
   - If hashes match, `stale = false`
   - If hashes differ, `stale = true`

6. **Apply staleness strategy:**
   - `'skip'`: if `stale === true`, return `null`
   - `'warn'`: return the result with `stale: true` flag (caller decides)
   - `'revalidate'`: for v1, behave identically to `'warn'` (placeholder for future AI-powered revalidation)

7. **Return** `{ entry, score, stale }`.

#### Tokenization Algorithm

```typescript
private static readonly STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'but', 'and', 'or', 'if', 'while', 'what', 'which',
    'who', 'whom', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
    'myself', 'we', 'our', 'ours', 'you', 'your', 'yours', 'he', 'him',
    'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their',
]);

/**
 * Tokenize a question string into a set of meaningful words.
 *
 * Steps:
 * 1. Lowercase the input
 * 2. Replace non-alphanumeric chars (except hyphens in identifiers) with spaces
 * 3. Split on whitespace
 * 4. Remove stop words
 * 5. Remove tokens shorter than 2 characters
 * 6. Return as a Set<string>
 */
static tokenize(text: string): Set<string> {
    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !ToolCallCacheRetriever.STOP_WORDS.has(w));
    return new Set(words);
}
```

**Design choice:** Hyphens are preserved to keep identifiers like `branch-service`, `git-diff`, `tool-call` as single tokens (important for codebase questions). The existing `normalizeText()` in `text-matching.ts` only normalizes line endings — it doesn't tokenize, so we need a dedicated function here. The existing `calculateSimilarity()` in `text-matching.ts` uses Levenshtein distance on full strings, which is character-level and unsuitable for question matching (e.g., "how does auth work" vs "how does authentication work" would score low on Levenshtein but high on word overlap). Jaccard on word tokens is the right granularity for natural-language question matching.

#### Jaccard Similarity Algorithm

```typescript
/**
 * Compute Jaccard similarity coefficient between two token sets.
 *
 * Jaccard(A, B) = |A ∩ B| / |A ∪ B|
 *
 * Returns 0 if both sets are empty.
 */
static jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;

    let intersection = 0;
    // Iterate over the smaller set for efficiency
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const token of smaller) {
        if (larger.has(token)) {
            intersection++;
        }
    }

    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}
```

**Threshold constant:** `DEFAULT_SIMILARITY_THRESHOLD = 0.4`. This is intentionally lower than the `minSimilarityThreshold: 0.6` in `text-matching.ts` (`AnchorMatchConfig`) because Jaccard on word tokens is sparser than Levenshtein on character sequences — two semantically similar questions may share only ~40-50% of their content words. Example: "what files are in the utils directory" vs "list files in utils folder" → shared tokens after stop-word removal: {files, utils} out of {files, utils, directory} ∪ {list, files, utils, folder} = 2/4 = 0.5, which should be a match.

#### Consolidated Cache Loading

```typescript
/**
 * Load consolidated entries from the store. Cached for the lifetime of
 * the retriever instance.
 *
 * Reads consolidated.json via store.readConsolidated(), which returns
 * the JSON array of ConsolidatedToolCallEntry objects written by
 * ToolCallCacheAggregator.
 *
 * Returns empty array if no consolidated data exists.
 */
private async loadConsolidated(): Promise<ConsolidatedToolCallEntry[]> {
    if (this.consolidatedCache !== null) {
        return this.consolidatedCache;
    }
    const data = await this.store.readConsolidated();
    this.consolidatedCache = data ?? [];
    return this.consolidatedCache;
}
```

**Cache invalidation:** The `incrementHitCount()` method writes back to consolidated.json, so it must also update `this.consolidatedCache` to keep the in-memory view consistent. No file-watcher needed — the retriever is short-lived (one per session/request).

#### `incrementHitCount(entryId: string): Promise<void>`

```typescript
/**
 * Increment the hit count for a matched entry.
 *
 * 1. Load consolidated entries (from cache)
 * 2. Find entry by id
 * 3. Increment entry.hitCount
 * 4. Write back via store.writeConsolidated()
 * 5. Update in-memory cache
 */
async incrementHitCount(entryId: string): Promise<void> {
    const entries = await this.loadConsolidated();
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    entry.hitCount = (entry.hitCount ?? 0) + 1;
    entry.lastHitTimestamp = new Date().toISOString();
    await this.store.writeConsolidated(entries);
    // In-memory cache already updated (mutated in-place)
}
```

**Pattern reference:** The write-back-after-mutation pattern mirrors `MemoryAggregator.aggregate()` at `memory-aggregator.ts:81-96` — the aggregator writes consolidated and then updates the index. Here, the retriever writes consolidated only (no separate index for tool-call-cache in v1).

#### `invalidateCache(): void`

Simple method to force reload on next `lookup()`:

```typescript
invalidateCache(): void {
    this.consolidatedCache = null;
}
```

### Assumed Store API (from 001)

The retriever depends on these `ToolCallCacheStore` methods from commit 001:

```typescript
interface ToolCallCacheStore {
    readConsolidated(): Promise<ConsolidatedToolCallEntry[] | null>;
    writeConsolidated(entries: ConsolidatedToolCallEntry[]): Promise<void>;
    // ... other methods not used by retriever
}
```

### Assumed `ConsolidatedToolCallEntry` Shape (from 001/003)

```typescript
interface ConsolidatedToolCallEntry {
    /** Unique identifier for the entry */
    id: string;
    /** The original question/prompt that triggered the explore */
    question: string;
    /** The consolidated answer/response */
    answer: string;
    /** Git commit hash when this entry was captured */
    gitHash?: string;
    /** ISO 8601 timestamp of when this entry was created/last updated */
    timestamp: string;
    /** Number of times this entry was returned as a cache hit */
    hitCount: number;
    /** ISO 8601 timestamp of last cache hit */
    lastHitTimestamp?: string;
    /** Tool calls that produced this answer */
    toolCalls?: CapturedToolCall[];
    /** Source file paths referenced in the answer */
    sourcePaths?: string[];
}
```

### Barrel Export Updates (`index.ts`)

Add after existing tool-call-cache exports:

```typescript
export { ToolCallCacheRetriever } from './tool-call-cache-retriever';
export type { ToolCallCacheRetrieverOptions } from './tool-call-cache-retriever';
export type { ToolCallCacheLookupResult, StalenessStrategy } from './tool-call-cache-types';
```

## Tests

All tests use Vitest, following the pattern established by existing memory tests (e.g., `memory-aggregator.test.ts`). The store is mocked to avoid filesystem I/O.

1. **Exact match returns high score** — Store has entry with question "what files are in src/utils", lookup with same question → score ≈ 1.0, entry returned
2. **Similar question returns match above threshold** — Store has "what files are in src/utils", lookup with "list the files in the utils directory" → score > 0.4, entry returned
3. **Dissimilar question returns null** — Store has "what files are in src/utils", lookup with "how does authentication work" → score < 0.4, returns null
4. **Stale entry with strategy=skip returns null** — Entry has gitHash "abc123", currentGitHash is "def456", strategy is 'skip' → returns null
5. **Stale entry with strategy=warn returns result with stale=true** — Same hash mismatch but strategy is 'warn' → returns `{ entry, score, stale: true }`
6. **Non-stale entry returns stale=false** — Entry gitHash matches currentGitHash → `stale: false`
7. **No currentGitHash treats entry as not stale** — currentGitHash is undefined → `stale: false`
8. **Entry with no gitHash treated as stale** — Entry has no gitHash, currentGitHash is provided → `stale: true`
9. **Hit count incremented on lookup** — After `incrementHitCount(id)`, store's consolidated has incremented hitCount and updated lastHitTimestamp
10. **Empty consolidated returns null** — Store returns null from readConsolidated → lookup returns null
11. **Multiple entries returns best match** — Store has 3 entries, lookup question is closest to entry #2 → entry #2 returned with highest score
12. **Consolidated cached across lookups** — Two calls to `lookup()` only call `store.readConsolidated()` once
13. **invalidateCache forces reload** — After `invalidateCache()`, next lookup calls `store.readConsolidated()` again
14. **Tokenize strips stop words** — `tokenize("what is the structure of the auth module")` → `Set(['structure', 'auth', 'module'])`
15. **Tokenize preserves hyphenated identifiers** — `tokenize("branch-service git-diff")` → `Set(['branch-service', 'git-diff'])`
16. **Jaccard similarity edge cases** — empty sets → 0, identical sets → 1.0, disjoint sets → 0
17. **Revalidate strategy behaves as warn in v1** — strategy 'revalidate' with stale entry → same as 'warn'

### Test Structure

```typescript
describe('ToolCallCacheRetriever', () => {
    describe('tokenize', () => { ... });
    describe('jaccardSimilarity', () => { ... });
    describe('lookup', () => {
        describe('matching', () => { ... });
        describe('staleness', () => { ... });
    });
    describe('incrementHitCount', () => { ... });
    describe('caching', () => { ... });
});
```

## Acceptance Criteria

- [ ] `ToolCallCacheRetriever` class created with `lookup()`, `incrementHitCount()`, `invalidateCache()` methods
- [ ] Keyword-based Jaccard similarity works for common explore question patterns (exact, similar, dissimilar)
- [ ] Staleness detection based on git hash comparison with three strategies (skip/warn/revalidate)
- [ ] Hit count tracking increments correctly and persists via store
- [ ] No AI dependency in v1 retrieval — pure algorithmic matching
- [ ] Consolidated data cached in-memory per retriever instance; invalidated on write
- [ ] `ToolCallCacheLookupResult` and `StalenessStrategy` types exported from barrel
- [ ] All 17 tests pass

## Dependencies

- Depends on: **001** (ToolCallCacheStore interface, ConsolidatedToolCallEntry type, FileToolCallCacheStore)
- Depends on: **003** (ToolCallCacheAggregator producing consolidated.json that this retriever reads)
- No dependency on 002 (capture is a write-path concern)

## Assumed Prior State

From **001 (Types & Store):**
- `ToolCallCacheStore` interface with `readConsolidated(): Promise<ConsolidatedToolCallEntry[] | null>` and `writeConsolidated(entries: ConsolidatedToolCallEntry[]): Promise<void>`
- `ConsolidatedToolCallEntry` type with fields: `id`, `question`, `answer`, `gitHash?`, `timestamp`, `hitCount`, `lastHitTimestamp?`, `toolCalls?`, `sourcePaths?`
- `tool-call-cache-types.ts` file exists with these type definitions

From **003 (Aggregation):**
- `ToolCallCacheAggregator` writes `consolidated.json` as a JSON array of `ConsolidatedToolCallEntry` objects
- The aggregator deduplicates and merges raw captured tool calls into consolidated entries
- `consolidated.json` is stored at the store's configured data directory root
