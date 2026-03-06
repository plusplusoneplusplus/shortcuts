---
status: pending
---

# 001: Memory Types and Interfaces

## Summary

Define all TypeScript types and interfaces for the CoC memory system. This establishes the complete data contract — storage schemas, config shapes, and the `MemoryStore` public API — before any implementation logic.

## Motivation

Pure types with zero runtime logic make an ideal first commit: they compile-verify the entire contract, unblock all downstream implementation commits in parallel, and produce a clean diff that's trivial to review. Every subsequent commit (file store, capture, retrieval, aggregation) imports from these types.

## Changes

### Files to Create

- `packages/pipeline-core/src/memory/types.ts` — All type/interface definitions for the memory system
- `packages/pipeline-core/src/memory/index.ts` — Barrel re-export of everything from `types.ts`

### Files to Modify

- (none for this commit)

### Files to Delete

- (none)

## Implementation Notes

Follow the conventions observed in `pipeline-core`:
- JSDoc on every exported interface and every non-obvious field (see `pipeline/types.ts` pattern)
- File header comment block describing the module (see `process-store.ts` lines 1-8)
- Options interfaces use `?` for every field with documented defaults (see `FileProcessStoreOptions`)
- String-literal union types for enums (see `FilterOperator`, `PipelinePhase`)
- Interface methods return `Promise<T>` for all I/O operations (see `ProcessStore`)
- No VS Code dependencies — this is pure Node.js (consistent with all `pipeline-core` code)

### Data Types

#### `RawObservationMetadata`

Maps to the YAML frontmatter in `raw/<timestamp>-<pipeline-id>.md`:

```ts
interface RawObservationMetadata {
  /** Pipeline name that produced this observation (e.g. "code-review") */
  pipeline: string;
  /** ISO 8601 timestamp of when the observation was captured */
  timestamp: string;
  /** Repository identifier (e.g. "github/shortcuts") */
  repo?: string;
  /** AI model used for the pipeline run */
  model?: string;
}
```

#### `RawObservation`

Full raw observation file content (metadata + body):

```ts
interface RawObservation {
  /** Frontmatter metadata */
  metadata: RawObservationMetadata;
  /** Markdown body — bullet list of facts */
  content: string;
  /** Filename (e.g. "20260228T150000Z-code-review.md") */
  filename: string;
}
```

#### `ConsolidatedMemory`

Parsed representation of `consolidated.md`:

```ts
interface ConsolidatedMemory {
  /** Raw markdown content of the consolidated file */
  content: string;
  /** ISO 8601 timestamp when this consolidation was last written */
  lastUpdated?: string;
}
```

Keep this intentionally simple for v1 — just the raw markdown string. Section parsing can be added later if selective retrieval needs it.

#### `MemoryIndex`

Maps 1:1 to `index.json` on disk:

```ts
interface MemoryIndex {
  /** ISO 8601 timestamp of last aggregation run */
  lastAggregation: string | null;
  /** Number of unprocessed raw observation files */
  rawCount: number;
  /** Number of facts in consolidated memory */
  factCount: number;
  /** Topic categories present in consolidated memory */
  categories: string[];
}
```

#### `RepoInfo`

Maps 1:1 to `repo-info.json` inside each `repos/<hash>/` directory:

```ts
interface RepoInfo {
  /** Absolute path to the repository root */
  path: string;
  /** Human-readable repo name (e.g. "shortcuts") */
  name: string;
  /** Git remote URL (origin), if available */
  remoteUrl?: string;
  /** ISO 8601 timestamp of last memory access for this repo */
  lastAccessed: string;
}
```

#### `MemoryLevel`

String-literal union for the two isolation levels plus both:

```ts
type MemoryLevel = 'repo' | 'system' | 'both';
```

#### `MemoryConfig`

Schema for the `memory` field in pipeline YAML. Supports both `memory: true` (shorthand) and the granular object form:

```ts
interface MemoryConfig {
  /** Whether to inject consolidated memory into prompts before AI calls */
  retrieve: boolean;
  /** Whether to capture observations after AI calls */
  capture: boolean;
  /** Which memory level(s) to read/write. Default: 'both' */
  level: MemoryLevel;
}
```

The YAML parser (not in this commit) will normalize `memory: true` → `{ retrieve: true, capture: true, level: 'both' }`.

#### `MemoryStoreOptions`

Constructor options, following the `FileProcessStoreOptions` pattern:

```ts
interface MemoryStoreOptions {
  /** Root directory for all memory data. Default: ~/.coc/memory */
  dataDir?: string;
}
```

#### `MemoryStats`

Return type for the per-level `getStats()` method:

```ts
interface MemoryStats {
  /** Number of raw observation files at this level */
  rawCount: number;
  /** Whether consolidated.md exists at this level */
  consolidatedExists: boolean;
  /** ISO 8601 timestamp of last aggregation, or null if never aggregated */
  lastAggregation: string | null;
  /** Number of facts in consolidated memory (from index.json) */
  factCount: number;
}
```

### Store Interface

#### `MemoryStore`

The public API contract. All I/O methods return Promises. Follows the `ProcessStore` pattern of grouping related methods with JSDoc section comments.

```ts
interface MemoryStore {
  // --- Raw observations ---

  /** Write a new raw observation file. Returns the generated filename. */
  writeRaw(level: MemoryLevel, repoHash: string | undefined, metadata: RawObservationMetadata, content: string): Promise<string>;

  /** List raw observation filenames, newest first. */
  listRaw(level: MemoryLevel, repoHash: string | undefined): Promise<string[]>;

  /** Read a single raw observation by filename. */
  readRaw(level: MemoryLevel, repoHash: string | undefined, filename: string): Promise<RawObservation | undefined>;

  /** Delete a raw observation file by filename. Returns true if deleted. */
  deleteRaw(level: MemoryLevel, repoHash: string | undefined, filename: string): Promise<boolean>;

  // --- Consolidated memory ---

  /** Read consolidated memory as raw markdown string. Returns null if no consolidation has run. */
  readConsolidated(level: MemoryLevel, repoHash?: string): Promise<string | null>;

  /** Write consolidated memory (atomic: tmp → rename). */
  writeConsolidated(level: MemoryLevel, content: string, repoHash?: string): Promise<void>;

  // --- Index ---

  /** Read the memory index. Returns a default index if none exists. */
  readIndex(level: MemoryLevel, repoHash: string | undefined): Promise<MemoryIndex>;

  /** Update the memory index (partial merge). */
  updateIndex(level: MemoryLevel, repoHash: string | undefined, updates: Partial<MemoryIndex>): Promise<void>;

  // --- Repo info ---

  /** Get repo info for a repo hash. Returns null if repo not registered. */
  getRepoInfo(repoHash: string): Promise<RepoInfo | null>;

  /** Create or update repo info for a repo hash (partial merge). */
  updateRepoInfo(repoHash: string, info: Partial<RepoInfo>): Promise<void>;

  /** Compute a stable hash for a repository root path. Pure function (no I/O). */
  computeRepoHash(repoPath: string): string;

  // --- Management ---

  /** Clear memory at the given level. If rawOnly=true, keeps consolidated.md and index.json. */
  clear(level: MemoryLevel, repoHash?: string, rawOnly?: boolean): Promise<void>;

  /** Return statistics for a specific memory level. */
  getStats(level: MemoryLevel, repoHash?: string): Promise<MemoryStats>;

  /** List all repo hashes that have memory stored. */
  listRepos(): Promise<string[]>;

  // --- Path helpers ---

  /** Get the absolute path to the system memory directory. */
  getSystemDir(): string;

  /** Get the absolute path to a repo's memory directory. */
  getRepoDir(repoHash: string): string;
}
```

**Key design decisions for the interface:**

1. **`level` + `repoHash` pattern:** Methods that operate on either system or repo memory take a `level` param. When `level` is `'repo'` or `'both'`, `repoHash` must be provided. When `level` is `'system'`, `repoHash` is `undefined`. This avoids separate method pairs (e.g., `writeRawRepo` / `writeRawSystem`).

2. **`writeRaw` returns filename:** The caller doesn't choose filenames — the store generates `<timestamp>-<pipeline-id>.md` internally. Returning the filename lets callers reference it later.

3. **`computeRepoHash` is sync:** It's a pure hash computation (no disk I/O), so it returns `string` directly, not `Promise<string>`. This matches the design doc's "hash of repo root path" approach.

4. **`readIndex` never returns undefined:** If no index exists, it returns a sensible default (`{ lastAggregation: null, rawCount: 0, factCount: 0, categories: [] }`). This simplifies consumer code.

5. **`clear` with optional `repoHash` and `rawOnly`:** When `rawOnly=true`, clears only `raw/` directory contents, preserving `consolidated.md` and `index.json`. Supports `coc memory clear --raw`.

6. **`readConsolidated` returns raw string:** Rather than wrapping in a `ConsolidatedMemory` object, the store returns the raw markdown string. The `ConsolidatedMemory` type is kept for future structured parsing but the store API is string-based for simplicity.

7. **`listRepos`:** Returns repo hashes (directory names under `repos/`). Needed by management operations and `coc memory show`.

### Barrel Export (`index.ts`)

```ts
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
```

Types-only re-export. No runtime code. The `MemoryStore` interface will be implemented in commit 2 (`FileMemoryStore`).

## Tests

- None needed — this commit contains only TypeScript types and interfaces with no runtime logic. The TypeScript compiler validates correctness at build time. Downstream commits will exercise these types through integration tests.

## Acceptance Criteria

- [ ] `packages/pipeline-core/src/memory/types.ts` exists with all 10 exported types/interfaces listed above
- [ ] `packages/pipeline-core/src/memory/index.ts` re-exports all types from `types.ts`
- [ ] Every exported interface and every field has a JSDoc comment
- [ ] `MemoryStore` interface has all 16 methods with correct signatures matching the spec above
- [ ] `MemoryIndex`, `RepoInfo`, and `RawObservationMetadata` field names match the design doc's JSON/YAML schemas exactly
- [ ] `MemoryConfig` supports the design doc's `retrieve`, `capture`, and `level` fields
- [ ] No runtime code — only `type`, `interface`, and string-literal union exports
- [ ] `npm run build` succeeds with no type errors
- [ ] No VS Code dependencies anywhere in the new files

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit.
