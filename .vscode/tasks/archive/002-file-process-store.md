---
status: pending
commit: "002"
feature: ai-exec-server
title: "Implement file-based ProcessStore"
---

# 002 — Implement file-based ProcessStore

## Summary

Implement `FileProcessStore`, a file-backed implementation of the `ProcessStore` interface (defined in commit 001). This provides persistent AI process storage outside VS Code, using JSON files in a configurable data directory (`~/.pipeline-server/` by default). The store supports multi-workspace process tagging, atomic writes, and automatic retention pruning.

## Motivation

The `pipeline serve` command needs to persist AI process state between server restarts without depending on VS Code's Memento API. A file-based JSON store is the simplest option that requires no external database, works on all platforms, and is human-inspectable for debugging.

## Files

| File | Action | Purpose |
|------|--------|---------|
| `packages/pipeline-core/src/file-process-store.ts` | **NEW** | `FileProcessStore` class + helper utilities |
| `packages/pipeline-core/src/index.ts` | EDIT | Export `FileProcessStore`, `getDefaultDataDir`, `ensureDataDir` |
| `packages/pipeline-core/test/file-process-store.test.ts` | **NEW** | Vitest tests |

## Design

### Storage Layout

```
~/.pipeline-server/          # default dataDir (configurable)
├── processes.json            # all processes, all workspaces
└── workspaces.json           # workspace registry
```

Single-file storage is chosen over per-workspace directories because cross-workspace queries (e.g., "show all running processes") are a primary use case for the server dashboard.

### FileProcessStore Class

```typescript
// packages/pipeline-core/src/file-process-store.ts

import { ProcessStore, WorkspaceInfo } from './process-store'; // from commit 001
import {
    AIProcess,
    SerializedAIProcess,
    serializeProcess,
    deserializeProcess
} from './ai/process-types';

export interface FileProcessStoreOptions {
    dataDir?: string;          // default: getDefaultDataDir()
    maxProcesses?: number;     // default: 500
}

export class FileProcessStore implements ProcessStore {
    private readonly dataDir: string;
    private readonly maxProcesses: number;
    private readonly processesPath: string;   // {dataDir}/processes.json
    private readonly workspacesPath: string;  // {dataDir}/workspaces.json
    private writeQueue: Promise<void>;        // sequential write queue

    constructor(options?: FileProcessStoreOptions);

    // --- ProcessStore interface (from commit 001) ---
    // Note: workspaceId is carried inside process.metadata.workspaceId (set by caller)
    addProcess(process: AIProcess): Promise<void>;
    getProcess(id: string): Promise<AIProcess | undefined>;
    getAllProcesses(filter?: ProcessFilter): Promise<AIProcess[]>;
    updateProcess(id: string, updates: Partial<AIProcess>): Promise<void>;
    removeProcess(id: string): Promise<void>;
    clearProcesses(filter?: ProcessFilter): Promise<number>;

    registerWorkspace(info: WorkspaceInfo): Promise<void>;
    getWorkspaces(): Promise<WorkspaceInfo[]>;

    // --- Internal helpers ---
    private readProcesses(): Promise<StoredProcessEntry[]>;
    private writeProcesses(entries: StoredProcessEntry[]): Promise<void>;
    private readWorkspaces(): Promise<WorkspaceInfo[]>;
    private writeWorkspaces(workspaces: WorkspaceInfo[]): Promise<void>;
    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T>;
    private pruneIfNeeded(entries: StoredProcessEntry[]): StoredProcessEntry[];
}
```

### Internal Storage Format

```typescript
/** On-disk shape inside processes.json */
interface StoredProcessEntry {
    workspaceId: string;
    process: SerializedAIProcess;   // uses existing serializeProcess()
}
```

`processes.json` stores an array of `StoredProcessEntry`. The existing `serializeProcess` / `deserializeProcess` functions handle `Date ↔ ISO-string` conversion — no new serialization logic needed.

### Key Behaviors

#### Atomic Writes

Every write follows the pattern:
1. Write content to `{file}.tmp` (same directory, guaranteed same filesystem)
2. `fs.rename('{file}.tmp', '{file}')` — atomic on POSIX; near-atomic on Windows NTFS

This prevents corruption if the process crashes mid-write.

#### Sequential Write Queue

A promise chain (`writeQueue`) ensures writes are serialized:

```typescript
private writeQueue = Promise.resolve();

private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(fn);
    this.writeQueue = result.then(() => {}, () => {});  // swallow for chain
    return result;
}
```

All mutations (`addProcess`, `updateProcess`, `removeProcess`, `clearProcesses`) are routed through `enqueueWrite`. This avoids file locking complexity while preventing concurrent write corruption within a single server process.

#### Read-Through

Every read loads directly from the file (no in-memory cache). This ensures correctness if multiple server instances share the same data directory. A future optimization could add `fs.stat` mtime caching, but simplicity wins for v1.

#### Retention Pruning

On `addProcess`, if total process count exceeds `maxProcesses` (default 500):
1. Sort entries by `process.startTime` ascending
2. Remove oldest entries until count ≤ `maxProcesses`
3. Only prune terminal processes (`completed`, `failed`, `cancelled`) — never prune `running` or `queued`

### Helper Utilities

```typescript
/** Returns '~/.pipeline-server/' with ~ expanded via os.homedir() */
export function getDefaultDataDir(): string;

/** Creates directory (and parents) if it doesn't exist. Returns resolved path. */
export function ensureDataDir(dirPath: string): Promise<string>;
```

### Export Surface

Add to `packages/pipeline-core/src/index.ts`:

```typescript
export {
    FileProcessStore,
    FileProcessStoreOptions,
    getDefaultDataDir,
    ensureDataDir
} from './file-process-store';
```

## Tests

File: `packages/pipeline-core/test/file-process-store.test.ts`

All tests use a temp directory (via `os.tmpdir()`) cleaned up in `afterEach`.

| Test | Description |
|------|-------------|
| **Empty store** | `getProcesses()` returns `[]`; `getProcess('x')` returns `undefined` |
| **Add and get** | `addProcess` → `getProcess` round-trips correctly (Date objects restored) |
| **Update** | `updateProcess` mutates only specified fields; others preserved |
| **Remove** | `removeProcess` deletes process; subsequent `getProcess` returns `undefined` |
| **Multi-workspace filtering** | Processes added with different `workspaceId` values; `getProcesses(id)` returns only that workspace's processes; `getProcesses()` returns all |
| **Clear by workspace** | `clearProcesses(id)` removes only that workspace; others intact |
| **Clear all** | `clearProcesses()` removes everything |
| **Retention limit** | Add 502 processes with `maxProcesses: 500`; verify count ≤ 500; verify `running`/`queued` processes are never pruned |
| **Persistence across instances** | Create store, add process, create new `FileProcessStore` with same `dataDir`; verify process is readable |
| **Atomic write safety** | Fire multiple concurrent `addProcess` calls; verify no data loss or JSON corruption |
| **Workspace registration** | `registerWorkspace` → `getWorkspaces` round-trips; duplicate registration updates (upsert) |
| **getDefaultDataDir** | Returns path ending in `.pipeline-server` under `os.homedir()` |
| **ensureDataDir** | Creates nested directory; second call is idempotent |

## Acceptance Criteria

- [ ] `FileProcessStore` implements `ProcessStore` interface from commit 001
- [ ] Processes persist across store instances (verified by test)
- [ ] Multi-workspace filtering works correctly (`getProcesses(workspaceId)`)
- [ ] Retention limit enforced — max 500, only terminal processes pruned
- [ ] Atomic writes — concurrent mutations don't corrupt `processes.json`
- [ ] `getDefaultDataDir()` and `ensureDataDir()` exported and tested
- [ ] All existing `pipeline-core` tests still pass (`npm run test:run`)

## Dependencies

- **Commit 001**: `ProcessStore` interface, `WorkspaceInfo` type
- **Existing**: `serializeProcess`, `deserializeProcess`, `AIProcess`, `SerializedAIProcess` from `pipeline-core/src/ai/process-types.ts`
- **Node.js stdlib only**: `fs/promises`, `os`, `path` — no new npm dependencies
