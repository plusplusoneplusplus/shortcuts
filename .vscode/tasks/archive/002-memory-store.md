---
status: done
depends_on: ["001"]
title: "MemoryStore — file-based storage layer"
files_create:
  - packages/pipeline-core/src/memory/memory-store.ts
  - packages/pipeline-core/src/memory/index.ts
files_create_tests:
  - packages/pipeline-core/test/memory/memory-store.test.ts
---

# 002 — MemoryStore: file-based storage layer

## Summary

Implement the core file-based storage class that manages reading/writing raw observations, consolidated memory, and index files at both system and repo levels.

## Motivation

The storage layer is the foundation for both the write path (capture) and read path (retrieval). It encapsulates all file system operations with atomic writes and serialized access, ensuring no partial files or race conditions corrupt memory data.

## Files to create

| File | Purpose |
|------|---------|
| `packages/pipeline-core/src/memory/memory-store.ts` | `MemoryStore` class |
| `packages/pipeline-core/src/memory/index.ts` | Module barrel export |
| `packages/pipeline-core/test/memory/memory-store.test.ts` | Real-FS tests with temp dirs |

## Patterns to copy from `file-process-store.ts`

All patterns come from `packages/pipeline-core/src/file-process-store.ts`.

### Atomic write (lines 503–506, 518–522)

Every write goes through a `.tmp` file then `rename`:

```typescript
// From writeIndex() — line 503-506
const tmpPath = this.indexPath + '.tmp';
await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
await fs.rename(tmpPath, this.indexPath);
```

MemoryStore must use this same pattern for all writes (`atomicWrite` private method).

### Serialized write queue (lines 619–623)

All mutations go through a single promise chain to prevent concurrent writes:

```typescript
// From enqueueWrite() — line 619-623
private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn);
    this.writeQueue = result.then(() => {}, () => {});
    return result;
}
```

Copy this **exactly** into MemoryStore. The `() => {}` no-op error handler prevents unhandled rejection propagation while still forwarding the error to the caller via `result`.

### Directory creation with `ensureDataDir` (lines 59–63)

```typescript
// Standalone helper — line 59-63
export async function ensureDataDir(dirPath: string): Promise<string> {
    const resolved = path.resolve(dirPath);
    await fs.mkdir(resolved, { recursive: true });
    return resolved;
}
```

Reuse by importing from `file-process-store.ts`, or duplicate a private version if avoiding the cross-dependency is cleaner.

### Constructor pattern (lines 82–92)

```typescript
constructor(options?: FileProcessStoreOptions) {
    this.dataDir = options?.dataDir ?? getDefaultDataDir();
    // ... derive sub-paths ...
    this.writeQueue = Promise.resolve();
}
```

MemoryStore follows the same: optional `baseDir` in options, default `~/.coc/memory`, derive all sub-paths in constructor, initialize `writeQueue = Promise.resolve()`.

### Default data dir (line 54–56)

```typescript
export function getDefaultDataDir(): string {
    return path.join(os.homedir(), '.coc');
}
```

MemoryStore default: `path.join(os.homedir(), '.coc', 'memory')`.

## Utilities from `file-utils.ts`

`packages/pipeline-core/src/utils/file-utils.ts` provides synchronous helpers (`safeReadFile`, `safeWriteFile`, `ensureDirectoryExists`). Since `MemoryStore` is fully async (matching `FileProcessStore`), use `fs/promises` directly rather than these sync utils.

## MemoryStore class design

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { MemoryLevel, MemoryIndex, RawObservation, RepoInfo } from './types';

export interface MemoryStoreOptions {
    /** Base directory for memory files. Default: ~/.coc/memory */
    baseDir?: string;
}

export class MemoryStore {
    private readonly baseDir: string;
    private writeQueue: Promise<void>;

    constructor(options?: MemoryStoreOptions) {
        this.baseDir = options?.baseDir ?? path.join(os.homedir(), '.coc', 'memory');
        this.writeQueue = Promise.resolve();
    }

    // --- Path resolution ---

    getSystemDir(): string {
        return path.join(this.baseDir, 'system');
    }

    getRepoDir(repoPath: string): string {
        return path.join(this.baseDir, 'repos', MemoryStore.hashRepoPath(repoPath));
    }

    static hashRepoPath(repoPath: string): string {
        return crypto.createHash('sha256').update(repoPath).digest('hex').slice(0, 12);
    }

    // --- Repo identity ---

    async writeRepoInfo(repoPath: string, info: Partial<RepoInfo>): Promise<void> {
        await this.enqueueWrite(async () => {
            const dir = this.getRepoDir(repoPath);
            await this.ensureDir(dir);
            const filePath = path.join(dir, 'repo-info.json');
            // Merge with existing
            let existing: Partial<RepoInfo> = {};
            try {
                const data = await fs.readFile(filePath, 'utf-8');
                existing = JSON.parse(data);
            } catch { /* first write */ }
            const merged = { ...existing, ...info };
            await this.atomicWrite(filePath, JSON.stringify(merged, null, 2));
        });
    }

    // --- Raw observations ---

    async writeRaw(
        level: 'system' | 'repo',
        content: string,
        filename: string,
        repoPath?: string
    ): Promise<void> {
        await this.enqueueWrite(async () => {
            const dir = path.join(this.resolveDir(level, repoPath), 'raw');
            await this.ensureDir(dir);
            await this.atomicWrite(path.join(dir, filename), content);
        });
    }

    async listRawFiles(
        level: 'system' | 'repo',
        repoPath?: string
    ): Promise<string[]> {
        const dir = path.join(this.resolveDir(level, repoPath), 'raw');
        try {
            const entries = await fs.readdir(dir);
            return entries.filter(e => e.endsWith('.md')).sort();
        } catch {
            return [];
        }
    }

    async readRaw(
        level: 'system' | 'repo',
        filename: string,
        repoPath?: string
    ): Promise<string> {
        const dir = path.join(this.resolveDir(level, repoPath), 'raw');
        return fs.readFile(path.join(dir, filename), 'utf-8');
    }

    // --- Consolidated memory ---

    async readConsolidated(
        level: 'system' | 'repo',
        repoPath?: string
    ): Promise<string | null> {
        const filePath = path.join(this.resolveDir(level, repoPath), 'consolidated.md');
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch {
            return null;
        }
    }

    async writeConsolidated(
        level: 'system' | 'repo',
        content: string,
        repoPath?: string
    ): Promise<void> {
        await this.enqueueWrite(async () => {
            const dir = this.resolveDir(level, repoPath);
            await this.ensureDir(dir);
            await this.atomicWrite(path.join(dir, 'consolidated.md'), content);
        });
    }

    // --- Index ---

    async readIndex(
        level: 'system' | 'repo',
        repoPath?: string
    ): Promise<MemoryIndex | null> {
        const filePath = path.join(this.resolveDir(level, repoPath), 'index.json');
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as MemoryIndex;
        } catch {
            return null;
        }
    }

    async writeIndex(
        level: 'system' | 'repo',
        data: MemoryIndex,
        repoPath?: string
    ): Promise<void> {
        await this.enqueueWrite(async () => {
            const dir = this.resolveDir(level, repoPath);
            await this.ensureDir(dir);
            await this.atomicWrite(
                path.join(dir, 'index.json'),
                JSON.stringify(data, null, 2)
            );
        });
    }

    // --- Internal helpers ---

    private resolveDir(level: 'system' | 'repo', repoPath?: string): string {
        if (level === 'system') {
            return this.getSystemDir();
        }
        if (!repoPath) {
            throw new Error('repoPath is required for repo-level operations');
        }
        return this.getRepoDir(repoPath);
    }

    /** Atomic write: tmp file → rename (from FileProcessStore pattern) */
    private async atomicWrite(filePath: string, content: string): Promise<void> {
        const tmpPath = filePath + '.tmp';
        await fs.writeFile(tmpPath, content, 'utf-8');
        await fs.rename(tmpPath, filePath);
    }

    /** Serialized write queue (from FileProcessStore lines 619-623) */
    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => {}, () => {});
        return result;
    }

    private async ensureDir(dirPath: string): Promise<void> {
        await fs.mkdir(dirPath, { recursive: true });
    }

    /**
     * Generate a filename for a raw observation.
     * Format: <ISO-timestamp>-<pipeline-slug>.md
     * Colons replaced with dashes for Windows compatibility.
     */
    static generateRawFilename(timestamp: string, pipelineName: string): string {
        const ts = timestamp.replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
        const slug = (pipelineName || 'unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
        return `${ts}-${slug}.md`;
    }
}
```

### Raw file naming

Format: `<ISO-timestamp>-<pipeline-slug>.md`
Example: `2026-02-28T15-00-00-code-review.md`

Colons in ISO timestamps replaced with `-` for Windows filesystem compatibility.

### Raw file format

```markdown
---
timestamp: "2026-02-28T15:00:00.000Z"
pipeline: "code-review"
level: "repo"
---

- Prefers early returns over nested if-blocks
- Uses snake_case for database columns
```

## Barrel export (`index.ts`)

```typescript
export { MemoryStore, MemoryStoreOptions } from './memory-store';
export * from './types';
```

Note: `MemoryStore.generateRawFilename()` is a static method available on the class. `MemoryStore.hashRepoPath()` is also static.

## Test plan

Copy the real-FS + temp dir pattern from `packages/pipeline-core/test/file-process-store.test.ts` (lines 6–44):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('MemoryStore', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memstore-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
    // ...
});
```

### Test cases

| # | Test | Verifies |
|---|------|----------|
| 1 | Constructor creates base directory on first write | `ensureDir` is called |
| 2 | `hashRepoPath` returns same hash for same input | Determinism |
| 3 | `hashRepoPath` returns different hash for different inputs | Uniqueness |
| 4 | `hashRepoPath` returns 12-char hex string | Format contract |
| 5 | `writeRaw` creates `raw/` directory and file | Directory + file creation |
| 6 | `writeRaw` writes the provided content verbatim | Content passthrough |
| 7 | `generateRawFilename` produces expected format | Filename generation |
| 8 | `generateRawFilename` replaces colons for Windows | Cross-platform safety |
| 9 | `listRawFiles` returns `.md` files sorted | Filtering + ordering |
| 10 | `listRawFiles` returns empty array when dir missing | Graceful missing dir |
| 11 | `readRaw` returns file content | Read roundtrip |
| 12 | `readConsolidated` returns `null` when no file | Missing-file handling |
| 13 | `writeConsolidated` + `readConsolidated` roundtrip | Write/read cycle |
| 14 | `writeIndex` + `readIndex` roundtrip | JSON serialization cycle |
| 15 | `readIndex` returns `null` when no file | Missing-file handling |
| 16 | Concurrent writes don't corrupt (write queue) | `enqueueWrite` serialization |
| 17 | `writeRepoInfo` creates `repo-info.json` | Repo identity persistence |
| 18 | `writeRepoInfo` merges with existing data | Partial update semantics |
| 19 | `resolveDir` throws for repo level without `repoPath` | Input validation |
| 20 | System and repo dirs are distinct paths | Level isolation |

### Concurrent write test detail

```typescript
it('concurrent writes do not corrupt', async () => {
    const store = new MemoryStore({ baseDir: tmpDir });
    // Fire 10 parallel writeRaw calls
    const writes = Array.from({ length: 10 }, (_, i) => {
        const filename = MemoryStore.generateRawFilename(
            new Date(Date.now() + i * 1000).toISOString(),
            `pipeline-${i}`
        );
        const content = `---\npipeline: pipeline-${i}\n---\n\n- fact ${i}\n`;
        return store.writeRaw('system', content, filename);
    });
    await Promise.all(writes);
    const files = await store.listRawFiles('system');
    expect(files).toHaveLength(10);
});
```

## Acceptance criteria

- [ ] `MemoryStore` handles both `system` and `repo` levels via `resolveDir`
- [ ] Atomic writes — uses `.tmp` + `rename` (never partial files on crash)
- [ ] Serialized write queue — `enqueueWrite` prevents race conditions
- [ ] Real FS tests pass with temp directories (no mocks)
- [ ] Repo hash is deterministic (SHA-256, 12-char hex prefix)
- [ ] Raw files have YAML frontmatter matching the design doc format
- [ ] Barrel export re-exports `MemoryStore`, `MemoryStoreOptions`, and all types

## Dependencies

- **Depends on:** `001` (memory types — `MemoryLevel`, `MemoryConfig`, `RawObservation`, `MemoryIndex`, `RepoInfo`)
- **Depended on by:** `003+` (capture service, read path)
