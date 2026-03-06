---
status: done
---

# 002: MemoryStore Core — Path Resolution, Repo Hashing, Raw Observations

## Summary

Implement the `MemoryStore` class in `pipeline-core` with storage layout initialization, deterministic repo hashing, and full raw observation CRUD (write, read, list, delete). This is the foundational persistence layer that all higher-level memory operations (capture, retrieval, aggregation) will build on.

## Motivation

Raw observation writes are the hot-path operation during pipeline execution — they must be fast and reliable before any consolidation or retrieval logic can be layered on. Separating storage mechanics from AI-driven capture/aggregation keeps the core testable with pure file I/O and no AI dependencies.

## Changes

### Files to Create

- `packages/pipeline-core/src/memory/memory-store.ts` — `MemoryStore` class implementing the `MemoryStore` interface from types.ts
- `packages/pipeline-core/test/memory/memory-store.test.ts` — Vitest tests for all MemoryStore functionality

### Files to Modify

- `packages/pipeline-core/src/memory/index.ts` — Add `MemoryStore` class re-export (alongside existing type re-exports from 001)

### Files to Delete

- (none)

## Implementation Notes

### Constructor and Path Setup

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { MemoryStoreOptions, MemoryLevel, RawObservation, RawObservationMetadata, MemoryIndex } from './types';

export class FileMemoryStore implements MemoryStore {
    private readonly dataDir: string;
    private readonly systemDir: string;
    private readonly reposDir: string;
    private writeQueue: Promise<void>;

    constructor(options?: MemoryStoreOptions) {
        this.dataDir = options?.dataDir ?? path.join(os.homedir(), '.coc', 'memory');
        this.systemDir = path.join(this.dataDir, 'system');
        this.reposDir = path.join(this.dataDir, 'repos');
        this.writeQueue = Promise.resolve();
    }
}
```

**Pattern source:** Follow `FileProcessStore` constructor (line 82-92 of `file-process-store.ts`) — store all derived paths eagerly in constructor, initialize `writeQueue` to `Promise.resolve()`.

### Write Queue Serialization

```typescript
private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn);
    this.writeQueue = result.then(() => {}, () => {});
    return result;
}
```

**Pattern source:** Identical to `FileProcessStore.enqueueWrite` (line 619-623). Serializes all writes to prevent concurrent file corruption while allowing reads to proceed freely.

### Repo Hash Computation

```typescript
computeRepoHash(repoPath: string): string {
    return crypto.createHash('sha256')
        .update(path.resolve(repoPath))
        .digest('hex')
        .substring(0, 16);
}
```

**Pattern source:** Identical to `computeRepoId` in `packages/coc/src/server/queue-persistence.ts` (line 46-51) and `workspace-identity.ts` (line 29). Uses `path.resolve()` to normalize before hashing, truncates to 16 hex chars (64 bits — sufficient for collision avoidance across local repos).

Make this a public method on the class (the interface requires it) but also export a standalone `computeRepoHash` function for use outside the class.

### Directory Accessors

```typescript
getSystemDir(): string {
    return this.systemDir;
}

getRepoDir(repoHash: string): string {
    return path.join(this.reposDir, repoHash);
}
```

Pure path computation — no I/O.

### Storage Layout Initialization

```typescript
async ensureStorageLayout(level: MemoryLevel, repoHash?: string): Promise<void> {
    if (level === 'system' || level === 'both') {
        await fs.mkdir(path.join(this.systemDir, 'raw'), { recursive: true });
    }
    if ((level === 'repo' || level === 'both') && repoHash) {
        await fs.mkdir(path.join(this.reposDir, repoHash, 'raw'), { recursive: true });
    }
}
```

**Pattern source:** Follows `ensureDataDir` (line 59-63 of `file-process-store.ts`) — `recursive: true` is idempotent, safe to call repeatedly.

### Filename Sanitization

```typescript
private sanitizePipelineId(id: string): string {
    return id.replace(/[^a-zA-Z0-9\-_]/g, '_');
}
```

**Pattern source:** Identical regex to `FileProcessStore.sanitizeId` (line 484-486). Replaces any non-alphanumeric/dash/underscore character with `_`. Used to make pipeline IDs safe for filenames.

### Raw Observation Filename Generation

```typescript
private generateRawFilename(metadata: RawObservationMetadata): string {
    // ISO timestamp with colons replaced for filesystem safety
    const ts = metadata.timestamp.toISOString().replace(/:/g, '-');
    const pipeline = this.sanitizePipelineId(metadata.pipeline);
    return `${ts}-${pipeline}.md`;
}
```

**Format:** `2026-02-28T15-00-00.000Z-code-review.md` — ISO timestamp ensures chronological sorting via simple string sort.

### Writing Raw Observations

```typescript
async writeRawObservation(
    metadata: RawObservationMetadata,
    content: string,
    level: MemoryLevel,
    repoHash?: string
): Promise<string[]> {
    const paths: string[] = [];
    await this.enqueueWrite(async () => {
        const filename = this.generateRawFilename(metadata);
        const fileContent = this.formatRawObservation(metadata, content);

        if (level === 'system' || level === 'both') {
            const dir = path.join(this.systemDir, 'raw');
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, filename);
            const tmpPath = filePath + '.tmp';
            await fs.writeFile(tmpPath, fileContent, 'utf-8');
            await fs.rename(tmpPath, filePath);
            paths.push(filePath);
        }

        if ((level === 'repo' || level === 'both') && repoHash) {
            const dir = path.join(this.reposDir, repoHash, 'raw');
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, filename);
            const tmpPath = filePath + '.tmp';
            await fs.writeFile(tmpPath, fileContent, 'utf-8');
            await fs.rename(tmpPath, filePath);
            paths.push(filePath);
        }
    });
    return paths;
}
```

**Key patterns from FileProcessStore:**
- Atomic write via `tmp → rename` (line 518-522 of `file-process-store.ts`)
- `enqueueWrite` serialization for all mutations
- `mkdir({ recursive: true })` before write for safety

### Raw Observation File Format

```typescript
private formatRawObservation(metadata: RawObservationMetadata, content: string): string {
    const frontmatter = [
        '---',
        `pipeline: ${metadata.pipeline}`,
        `timestamp: ${metadata.timestamp.toISOString()}`,
    ];
    if (metadata.repo) frontmatter.push(`repo: ${metadata.repo}`);
    if (metadata.model) frontmatter.push(`model: ${metadata.model}`);
    frontmatter.push('---');
    return frontmatter.join('\n') + '\n\n' + content.trim() + '\n';
}
```

Produces markdown matching the design doc's raw observation format. YAML frontmatter parsed back via `parseRawObservation`.

### Parsing Raw Observations

```typescript
private parseRawObservation(fileContent: string, filePath: string): RawObservation {
    const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatterMatch) {
        throw new Error(`Invalid raw observation format: ${filePath}`);
    }
    const frontmatter = frontmatterMatch[1];
    const content = fileContent.slice(frontmatterMatch[0].length).trim();

    const metadata: RawObservationMetadata = {
        pipeline: this.extractField(frontmatter, 'pipeline') ?? 'unknown',
        timestamp: new Date(this.extractField(frontmatter, 'timestamp') ?? new Date().toISOString()),
        repo: this.extractField(frontmatter, 'repo'),
        model: this.extractField(frontmatter, 'model'),
    };

    return { metadata, content, filePath };
}

private extractField(frontmatter: string, field: string): string | undefined {
    const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
    return match?.[1]?.trim();
}
```

Simple regex-based YAML frontmatter parsing — no need for a full YAML parser for this flat key-value structure.

### Listing Raw Observations

```typescript
async listRawObservations(level: MemoryLevel, repoHash?: string): Promise<RawObservation[]> {
    const observations: RawObservation[] = [];

    const readDir = async (rawDir: string): Promise<void> => {
        try {
            const files = await fs.readdir(rawDir);
            const mdFiles = files.filter(f => f.endsWith('.md')).sort();
            for (const file of mdFiles) {
                const filePath = path.join(rawDir, file);
                const content = await fs.readFile(filePath, 'utf-8');
                observations.push(this.parseRawObservation(content, filePath));
            }
        } catch {
            // Directory may not exist yet — return empty
        }
    };

    if (level === 'system' || level === 'both') {
        await readDir(path.join(this.systemDir, 'raw'));
    }
    if ((level === 'repo' || level === 'both') && repoHash) {
        await readDir(path.join(this.reposDir, repoHash, 'raw'));
    }

    return observations;
}
```

**Pattern source:** Follows FileProcessStore's `readIndex` error-swallowing pattern (line 492-498) — missing directories return empty arrays instead of throwing.

### Reading a Single Raw Observation

```typescript
async readRawObservation(filePath: string): Promise<RawObservation> {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseRawObservation(content, filePath);
}
```

### Deleting Raw Observations

```typescript
async deleteRawObservations(filePaths: string[]): Promise<void> {
    await this.enqueueWrite(async () => {
        for (const filePath of filePaths) {
            try {
                await fs.unlink(filePath);
            } catch {
                // Ignore missing files — already deleted or never written
            }
        }
    });
}
```

**Pattern source:** Follows `FileProcessStore.deleteProcessFile` (line 524-530) — silently ignores ENOENT.

## Tests

All tests in `packages/pipeline-core/test/memory/memory-store.test.ts` using Vitest. Follow the FileProcessStore test pattern (lines 1-44 of `file-process-store.test.ts`).

### Test Setup

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FileMemoryStore', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-store-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
```

### Test Cases

1. **Repo hash stability** — `computeRepoHash('/some/path')` called twice returns the same 16-char hex string
2. **Repo hash uniqueness** — `computeRepoHash('/path/a')` !== `computeRepoHash('/path/b')`
3. **Repo hash uses resolved path** — `computeRepoHash('relative/path')` === `computeRepoHash(path.resolve('relative/path'))`
4. **ensureStorageLayout('system')** — creates `<dataDir>/system/raw/` directory
5. **ensureStorageLayout('repo', hash)** — creates `<dataDir>/repos/<hash>/raw/` directory
6. **ensureStorageLayout('both', hash)** — creates both system and repo directories
7. **ensureStorageLayout is idempotent** — calling twice doesn't throw
8. **writeRawObservation + readRawObservation roundtrip** — metadata (pipeline, timestamp, repo, model) and content are preserved exactly
9. **writeRawObservation to 'both' level** — writes files to both system/raw/ and repos/<hash>/raw/
10. **writeRawObservation file format** — written file has YAML frontmatter block and content body
11. **listRawObservations returns sorted files** — write 3 observations with different timestamps, list returns them in chronological order
12. **listRawObservations on empty/missing directory** — returns empty array, does not throw
13. **listRawObservations filters by level** — system-level observations not returned when listing repo-level and vice versa
14. **deleteRawObservations removes files** — write 2 observations, delete 1, list returns only the remaining one
15. **deleteRawObservations ignores missing files** — deleting a non-existent path does not throw
16. **Filename sanitization** — pipeline ID with special characters (`my/pipeline:v2`) produces safe filename (no `/`, `:`, etc.)
17. **Concurrent writes are serialized** — fire multiple writeRawObservation calls concurrently, all files are written correctly (no corruption)
18. **getSystemDir / getRepoDir return correct paths** — verify against expected path.join results

## Acceptance Criteria

- [ ] `FileMemoryStore` class is exported from `packages/pipeline-core/src/memory/index.ts`
- [ ] Constructor defaults `dataDir` to `~/.coc/memory/` when no options provided
- [ ] `computeRepoHash` returns a deterministic 16-char hex string using SHA-256 of `path.resolve(repoPath)`
- [ ] `ensureStorageLayout` creates the correct directory tree for system, repo, and both levels
- [ ] `writeRawObservation` produces atomic writes (tmp → rename pattern) serialized through write queue
- [ ] Raw observation files have YAML frontmatter with pipeline, timestamp, and optional repo/model fields
- [ ] `listRawObservations` returns parsed observations sorted chronologically, gracefully handles missing directories
- [ ] `readRawObservation` parses a single file into metadata + content
- [ ] `deleteRawObservations` removes specified files, ignores already-deleted paths
- [ ] Pipeline IDs are sanitized for filesystem safety (matching `FileProcessStore.sanitizeId` regex)
- [ ] All writes go through `enqueueWrite` to prevent concurrent file corruption
- [ ] All tests pass via `cd packages/pipeline-core && npm run test:run`
- [ ] No VS Code dependencies — pure Node.js only

## Dependencies

- Depends on: 001 (types and interfaces in `packages/pipeline-core/src/memory/types.ts`)

## Assumed Prior State

Types and interfaces from commit 001 exist in `packages/pipeline-core/src/memory/types.ts`:
- `RawObservation` — `{ metadata: RawObservationMetadata; content: string; filePath: string }`
- `RawObservationMetadata` — `{ pipeline: string; timestamp: Date; repo?: string; model?: string }`
- `ConsolidatedMemory`, `MemoryIndex`, `RepoInfo` — used in later commits
- `MemoryLevel` — `'system' | 'repo' | 'both'`
- `MemoryConfig` — pipeline YAML memory configuration
- `MemoryStoreOptions` — `{ dataDir?: string }`
- `MemoryStore` — interface declaring all public methods this commit implements

Re-exports exist in `packages/pipeline-core/src/memory/index.ts`.
