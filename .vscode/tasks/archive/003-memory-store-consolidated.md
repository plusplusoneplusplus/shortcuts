---
status: done
---

# 003: MemoryStore — Consolidated Memory, Index, and Management

## Summary

Add consolidated memory read/write with atomic tmp→rename writes, index management with merge semantics, repo-info tracking, clear/archive operations, storage stats, and repo listing. This completes the MemoryStore public API surface needed by downstream modules (MemoryRetriever, MemoryAggregator, `coc memory` CLI).

## Motivation

Commit 002 delivered raw observation CRUD — the write-hot path used during pipeline execution. This commit adds the remaining MemoryStore responsibilities: consolidated memory (the read-hot path used by MemoryRetriever), the metadata index (used by MemoryAggregator to decide when to batch), repo-info tracking (used by `coc memory show`), and management operations (used by `coc memory clear`). Splitting these from raw observation CRUD keeps each commit reviewable and testable in isolation.

## Changes

### Files to Create

- `packages/pipeline-core/test/memory/memory-store-consolidated.test.ts` — Tests for consolidated read/write, index CRUD, repo-info CRUD, clear operations, getStats, and listRepos

### Files to Modify

- `packages/pipeline-core/src/memory/memory-store.ts` — Add nine public methods: readConsolidated, writeConsolidated, readIndex, updateIndex, getRepoInfo, updateRepoInfo, clear, getStats, listRepos

### Files to Delete

- (none)

## Implementation Notes

### Write Queue Serialization

Follow the `FileProcessStore.enqueueWrite` pattern exactly. The MemoryStore class from commit 002 already has a `writeQueue: Promise<void>` field initialized to `Promise.resolve()` and a private `enqueueWrite<T>(fn: () => Promise<T>): Promise<T>` method that chains onto the queue. All write methods below MUST go through `enqueueWrite` to prevent concurrent writes from corrupting files.

```typescript
private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn);
    this.writeQueue = result.then(() => {}, () => {});
    return result;
}
```

### Atomic Write Helper

Extract a shared `atomicWrite` helper used by writeConsolidated, updateIndex, and updateRepoInfo. Mirrors the `FileProcessStore.writeIndex` / `writeProcessFile` pattern:

```typescript
private async atomicWrite(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
}
```

Key properties:
- Parent directory creation is idempotent (`recursive: true`)
- `fs.rename` is atomic on POSIX; on Windows, Node.js uses `MoveFileExW` which is atomic within the same volume
- `.tmp` suffix matches the pattern used in `FileProcessStore`
- The tmp file is a sibling (same directory), ensuring same-volume rename

### Path Resolution

Methods that accept `(level, repoHash?)` resolve to a directory via existing helpers from commit 002:

- `level === 'system'` → `this.getSystemDir()` → `<baseDir>/memory/system/`
- `level === 'repo'` → `this.getRepoDir(repoHash!)` → `<baseDir>/memory/repos/<repoHash>/`

For repo-level calls, `repoHash` is required; throw if missing. For system-level calls, `repoHash` is ignored.

### Method Signatures and Behavior

#### 1. readConsolidated(level: MemoryLevel, repoHash?: string): Promise<string | null>

```typescript
async readConsolidated(level: MemoryLevel, repoHash?: string): Promise<string | null> {
    const dir = level === 'system' ? this.getSystemDir() : this.getRepoDir(repoHash!);
    const filePath = path.join(dir, 'consolidated.md');
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}
```

- Pure read, no write queue needed
- Returns `null` when file doesn't exist (ENOENT), not an error
- Returns the full markdown string as-is

#### 2. writeConsolidated(level: MemoryLevel, content: string, repoHash?: string): Promise<void>

```typescript
async writeConsolidated(level: MemoryLevel, content: string, repoHash?: string): Promise<void> {
    return this.enqueueWrite(async () => {
        const dir = level === 'system' ? this.getSystemDir() : this.getRepoDir(repoHash!);
        const filePath = path.join(dir, 'consolidated.md');
        await this.atomicWrite(filePath, content);
    });
}
```

- Goes through write queue for serialization
- Uses atomic write (tmp→rename)

#### 3. readIndex(level: MemoryLevel, repoHash?: string): Promise<MemoryIndex>

```typescript
async readIndex(level: MemoryLevel, repoHash?: string): Promise<MemoryIndex> {
    const dir = level === 'system' ? this.getSystemDir() : this.getRepoDir(repoHash!);
    const filePath = path.join(dir, 'index.json');
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as MemoryIndex;
    } catch {
        return { lastAggregation: null, rawCount: 0, factCount: 0, categories: [] };
    }
}
```

- Pure read, no write queue
- Returns a default `MemoryIndex` when file doesn't exist, matching the design doc schema:
  ```json
  { "lastAggregation": null, "rawCount": 0, "factCount": 0, "categories": [] }
  ```
- `lastAggregation` is `string | null` (ISO 8601 timestamp or null if never aggregated)

#### 4. updateIndex(level: MemoryLevel, updates: Partial<MemoryIndex>, repoHash?: string): Promise<void>

```typescript
async updateIndex(level: MemoryLevel, updates: Partial<MemoryIndex>, repoHash?: string): Promise<void> {
    return this.enqueueWrite(async () => {
        const existing = await this.readIndex(level, repoHash);
        const merged: MemoryIndex = { ...existing, ...updates };
        const dir = level === 'system' ? this.getSystemDir() : this.getRepoDir(repoHash!);
        const filePath = path.join(dir, 'index.json');
        await this.atomicWrite(filePath, JSON.stringify(merged, null, 2));
    });
}
```

- Read-modify-write inside write queue (prevents lost updates)
- Shallow merge with spread operator — `updates` fields override `existing` fields
- Atomic write for the result

#### 5. getRepoInfo(repoHash: string): Promise<RepoInfo | null>

```typescript
async getRepoInfo(repoHash: string): Promise<RepoInfo | null> {
    const dir = this.getRepoDir(repoHash);
    const filePath = path.join(dir, 'repo-info.json');
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as RepoInfo;
    } catch {
        return null;
    }
}
```

- Pure read
- Returns `null` when file doesn't exist
- `RepoInfo` shape (from types.ts commit 001): `{ path: string; name: string; remoteUrl?: string; lastAccessed: string }`

#### 6. updateRepoInfo(repoHash: string, info: Partial<RepoInfo>): Promise<void>

```typescript
async updateRepoInfo(repoHash: string, info: Partial<RepoInfo>): Promise<void> {
    return this.enqueueWrite(async () => {
        const existing = await this.getRepoInfo(repoHash);
        const merged: RepoInfo = { path: '', name: '', lastAccessed: new Date().toISOString(), ...existing, ...info };
        const dir = this.getRepoDir(repoHash);
        const filePath = path.join(dir, 'repo-info.json');
        await this.atomicWrite(filePath, JSON.stringify(merged, null, 2));
    });
}
```

- Read-modify-write inside write queue
- Provides sensible defaults for required fields if creating for the first time
- Atomic write

#### 7. clear(level: MemoryLevel, repoHash?: string, rawOnly?: boolean): Promise<void>

```typescript
async clear(level: MemoryLevel, repoHash?: string, rawOnly?: boolean): Promise<void> {
    return this.enqueueWrite(async () => {
        const dir = level === 'system' ? this.getSystemDir() : this.getRepoDir(repoHash!);

        if (rawOnly) {
            // Delete only the raw/ directory contents, preserve consolidated.md and index.json
            const rawDir = path.join(dir, 'raw');
            try {
                await fs.rm(rawDir, { recursive: true, force: true });
                await fs.mkdir(rawDir, { recursive: true });
            } catch {
                // raw dir may not exist
            }
        } else {
            // Delete everything in the level directory
            try {
                await fs.rm(dir, { recursive: true, force: true });
            } catch {
                // dir may not exist
            }
        }
    });
}
```

- `rawOnly=true` (maps to `coc memory clear --raw`): removes `raw/` directory but keeps `consolidated.md`, `index.json`, and `repo-info.json`
- `rawOnly=false` (default): removes the entire level directory
- Recreates `raw/` after clearing when `rawOnly=true` so subsequent writes don't need to create it
- All operations inside write queue to prevent races with concurrent writes

#### 8. getStats(level: MemoryLevel, repoHash?: string): Promise<MemoryStats>

```typescript
interface MemoryStats {
    rawCount: number;
    consolidatedExists: boolean;
    lastAggregation: string | null;
    factCount: number;
}

async getStats(level: MemoryLevel, repoHash?: string): Promise<MemoryStats> {
    const dir = level === 'system' ? this.getSystemDir() : this.getRepoDir(repoHash!);
    const rawDir = path.join(dir, 'raw');

    // Count raw files
    let rawCount = 0;
    try {
        const entries = await fs.readdir(rawDir);
        rawCount = entries.filter(e => e.endsWith('.md')).length;
    } catch {
        // raw dir may not exist
    }

    // Check consolidated exists
    let consolidatedExists = false;
    try {
        await fs.access(path.join(dir, 'consolidated.md'));
        consolidatedExists = true;
    } catch {
        // doesn't exist
    }

    // Read index for metadata
    const index = await this.readIndex(level, repoHash);

    return {
        rawCount,
        consolidatedExists,
        lastAggregation: index.lastAggregation,
        factCount: index.factCount,
    };
}
```

- Pure read, no write queue
- `rawCount` counts `.md` files in `raw/` directory (matches `listRawObservations` from commit 002)
- `consolidatedExists` uses `fs.access` (cheap existence check)
- `lastAggregation` and `factCount` come from `index.json` via `readIndex`
- Note: `MemoryStats` is NOT in types.ts from commit 001 — add it to types.ts in this commit, OR inline it. Prefer adding to types.ts for reuse by CLI.

#### 9. listRepos(): Promise<string[]>

```typescript
async listRepos(): Promise<string[]> {
    const reposDir = path.join(this.baseDir, 'memory', 'repos');
    try {
        const entries = await fs.readdir(reposDir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return [];
    }
}
```

- Returns directory names under `repos/`, which are the repo hashes
- Returns empty array if `repos/` doesn't exist
- Pure read, no write queue

### Type Addition

Add `MemoryStats` to `packages/pipeline-core/src/memory/types.ts`:

```typescript
export interface MemoryStats {
    rawCount: number;
    consolidatedExists: boolean;
    lastAggregation: string | null;
    factCount: number;
}
```

Update `packages/pipeline-core/src/memory/index.ts` to export `MemoryStats` if not already covered by the wildcard re-export.

### Error Handling Strategy

- **Read methods** (readConsolidated, readIndex, getRepoInfo, getStats, listRepos): swallow ENOENT, return default/null. Other errors propagate.
- **Write methods** (writeConsolidated, updateIndex, updateRepoInfo): errors propagate to caller. The write queue ensures serialization but does not swallow errors.
- **clear**: swallows ENOENT (clearing non-existent data is a no-op). Other errors propagate.

## Tests

Test file: `packages/pipeline-core/test/memory/memory-store-consolidated.test.ts`

All tests use `fs.mkdtemp` for a temp `baseDir`, cleaned up in `afterEach` (matching `file-process-store.test.ts` pattern).

### Consolidated Memory Tests

1. **readConsolidated returns null when file doesn't exist** — Create fresh store, call `readConsolidated('system')`, assert returns `null`
2. **writeConsolidated and readConsolidated roundtrip** — Write markdown content, read it back, assert exact match
3. **writeConsolidated overwrites existing content** — Write content A, write content B, read back, assert content is B
4. **writeConsolidated uses atomic write (no partial content)** — Write content, verify no `.tmp` file remains in the directory after write completes
5. **writeConsolidated creates parent directories** — Write to a repo-level path that doesn't exist yet, assert succeeds and file is readable
6. **concurrent writeConsolidated calls serialize correctly** — Fire two `writeConsolidated` calls concurrently (Promise.all), verify final content is one of the two (not corrupted)

### Index Tests

7. **readIndex returns defaults when file doesn't exist** — Assert returns `{ lastAggregation: null, rawCount: 0, factCount: 0, categories: [] }`
8. **updateIndex creates index.json when it doesn't exist** — Call `updateIndex` with `{ factCount: 5 }`, read back, assert `factCount` is 5 and other fields are defaults
9. **updateIndex merges into existing index** — Write initial index, update only `factCount`, verify other fields preserved
10. **updateIndex with categories replaces categories array** — Update with new `categories`, verify old array is replaced (not appended)

### Repo Info Tests

11. **getRepoInfo returns null when file doesn't exist** — Assert returns `null`
12. **updateRepoInfo and getRepoInfo roundtrip** — Write repo info, read back, verify all fields match
13. **updateRepoInfo merges partial updates** — Create repo info, update only `lastAccessed`, verify `name` and `path` preserved

### Clear Tests

14. **clear with rawOnly=true preserves consolidated.md** — Write consolidated.md and raw observations, clear with `rawOnly=true`, verify consolidated.md still exists and raw files are gone
15. **clear with rawOnly=true preserves index.json** — Same as above but verify index.json survives
16. **clear with rawOnly=false removes everything** — Write consolidated.md, raw observations, and index.json, clear with `rawOnly=false`, verify entire level directory is removed
17. **clear on non-existent directory is a no-op** — Call clear on a repo hash that was never written to, assert no error

### Stats Tests

18. **getStats returns zeros/false for empty store** — Assert `{ rawCount: 0, consolidatedExists: false, lastAggregation: null, factCount: 0 }`
19. **getStats returns correct rawCount** — Write 3 raw observations (using `writeRawObservation` from commit 002), assert `rawCount` is 3
20. **getStats reflects consolidated existence** — Write consolidated.md, assert `consolidatedExists` is `true`
21. **getStats reads lastAggregation and factCount from index** — Update index with values, call getStats, verify they match

### listRepos Tests

22. **listRepos returns empty array when no repos exist** — Assert returns `[]`
23. **listRepos returns all repo directories** — Write observations to two different repo hashes, call `listRepos`, assert both hashes are returned
24. **listRepos ignores non-directory entries** — Create a stray file in the repos/ directory, verify it's not in the returned list

## Acceptance Criteria

- [ ] `readConsolidated` returns `null` for missing files, full content string for existing files
- [ ] `writeConsolidated` uses atomic tmp→rename pattern; no `.tmp` files left after completion
- [ ] All write methods (`writeConsolidated`, `updateIndex`, `updateRepoInfo`) go through `enqueueWrite` for serialization
- [ ] `readIndex` returns a valid default `MemoryIndex` when `index.json` doesn't exist
- [ ] `updateIndex` performs read-modify-write merge inside the write queue
- [ ] `getRepoInfo` / `updateRepoInfo` roundtrip correctly
- [ ] `clear(level, hash, true)` removes only `raw/` contents, preserving `consolidated.md` and `index.json`
- [ ] `clear(level, hash, false)` removes the entire level directory
- [ ] `getStats` returns accurate counts for raw files, consolidated existence, and index metadata
- [ ] `listRepos` returns directory names under `repos/`, empty array if none
- [ ] `MemoryStats` type is exported from `memory/types.ts` and `memory/index.ts`
- [ ] All 24 tests pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] No regressions in existing commit 002 tests

## Dependencies

- Depends on: 001 (types), 002 (MemoryStore class with constructor, path resolution, write queue, raw observation CRUD)

## Assumed Prior State

From **commit 001** (`types.ts`):
- `MemoryLevel` type: `'system' | 'repo'`
- `MemoryIndex` interface: `{ lastAggregation: string | null; rawCount: number; factCount: number; categories: string[] }`
- `RepoInfo` interface: `{ path: string; name: string; remoteUrl?: string; lastAccessed: string }`
- `MemoryConfig` interface (pipeline YAML memory config)
- `MemoryStoreOptions` interface: `{ baseDir?: string }` (defaults to `~/.coc/`)
- `RawObservation` and `RawObservationMetadata` interfaces

From **commit 002** (`memory-store.ts`):
- `MemoryStore` class with:
  - `constructor(options?: MemoryStoreOptions)` — sets `this.baseDir`, initializes `this.writeQueue = Promise.resolve()`
  - `computeRepoHash(repoPath: string): string` — stable hash of repo root path
  - `getSystemDir(): string` — returns `<baseDir>/memory/system/`
  - `getRepoDir(repoHash: string): string` — returns `<baseDir>/memory/repos/<repoHash>/`
  - `ensureStorageLayout(level, repoHash?): Promise<void>` — creates directory structure
  - `writeRawObservation(level, observation, repoHash?): Promise<string>` — writes raw `.md` file
  - `listRawObservations(level, repoHash?): Promise<string[]>` — lists raw file names
  - `readRawObservation(level, filename, repoHash?): Promise<RawObservation | null>` — reads and parses raw file
  - `deleteRawObservations(level, filenames, repoHash?): Promise<void>` — deletes specified raw files
  - Private `enqueueWrite<T>(fn: () => Promise<T>): Promise<T>` — write queue serialization
- `memory/index.ts` exports: all types from `types.ts` + `MemoryStore` class
