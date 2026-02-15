---
status: pending
priority: high
area: coc/persistence
---

# Wire FileProcessStore into `coc serve` for process persistence

## Why

Currently `coc serve` uses an in-memory stub store (`createStubStore()` in
`packages/coc/src/server/index.ts`). All processes are lost on restart.
`FileProcessStore` already exists in `pipeline-core` with atomic writes,
retention pruning (500 max), and multi-workspace support. We just need to
wire it into the serve command so that `~/.coc/processes.json` and
`~/.coc/workspaces.json` are created and maintained automatically.

## Current State

| Component | File | Role |
|---|---|---|
| Stub store | `packages/coc/src/server/index.ts` (`createStubStore()`) | In-memory `ProcessStore`; used as fallback when no `store` option is passed to `createExecutionServer()` |
| `createExecutionServer()` | `packages/coc/src/server/index.ts:110` | Accepts optional `store` via `ExecutionServerOptions.store`; defaults to stub |
| `executeServe()` | `packages/coc/src/commands/serve.ts:35` | CLI entry point; resolves `dataDir`, calls `createExecutionServer()` **without** a `store` option |
| `FileProcessStore` | `packages/pipeline-core/src/file-process-store.ts` | Persistent JSON file store with atomic writes, pruning, workspace registry |
| `ProcessStore` interface | `packages/pipeline-core/src/process-store.ts` | Abstract interface both stores implement |
| `ExecutionServerOptions` | `packages/coc/src/server/types.ts` | Already has `store?: ProcessStore` field |

## Changes

### 1. `packages/coc/src/commands/serve.ts`

Import `FileProcessStore` from `pipeline-core` and instantiate it with the
resolved `dataDir`, then pass it to `createExecutionServer()`.

```ts
// Add import at top
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';

// Inside executeServe(), after dataDir is resolved and before createExecutionServer():
const store = new FileProcessStore({ dataDir });

// Pass store into server options:
const server = await createExecutionServer({
    port,
    host,
    dataDir,
    store,                        // <-- new
    theme: options.theme ?? 'auto',
});
```

**What stays the same:**
- `resolveDataDir()` already expands `~` — no change needed.
- `fs.mkdirSync(dataDir, { recursive: true })` already runs before store creation — safe.
- The stub store in `index.ts` remains untouched as the fallback for tests and programmatic usage without an explicit store.

### 2. No changes to `packages/coc/src/server/index.ts`

The existing fallback logic on line 114 already handles this:

```ts
const store = options.store ?? createStubStore();
```

When `serve.ts` passes a `FileProcessStore`, it is used directly.
When no store is passed (tests, other callers), the stub store is used.

### 3. No changes to `packages/pipeline-core/`

`FileProcessStore` is already exported from the package and ready to use.

## File-by-file Summary

| File | Action |
|---|---|
| `packages/coc/src/commands/serve.ts` | Add `FileProcessStore` import; instantiate with `{ dataDir }`; pass as `store` to `createExecutionServer()` |
| `packages/coc/src/server/index.ts` | No change (stub store remains as fallback) |
| `packages/pipeline-core/src/file-process-store.ts` | No change |
| `packages/pipeline-core/src/process-store.ts` | No change |
| `packages/coc/src/server/types.ts` | No change |

## Tests

### New / Updated Tests

1. **FileProcessStore is used when serve starts**
   - Call `executeServe()` (or `createExecutionServer({ store })`) with a
     `FileProcessStore` pointed at a temp dir.
   - Add a process via the API, verify it appears in `processes.json` on disk.

2. **Processes survive server restart**
   - Start server with `FileProcessStore({ dataDir: tmpDir })`.
   - POST a process via REST API.
   - Stop server (`server.close()`).
   - Start a new server with the same `dataDir`.
   - GET processes — verify the previously created process is returned.

3. **Stub store still used when no store injected**
   - Call `createExecutionServer({})` without a `store` option.
   - Verify processes work in-memory (existing test compatibility).

4. **Integration: enqueue task via API → appears in processes.json**
   - Start server with file store.
   - POST to `/api/queue` to enqueue a task.
   - Wait for processing.
   - Read `processes.json` directly and confirm the entry exists.

### Existing Tests

All existing tests that call `createExecutionServer()` without passing a
`store` option will continue to use the stub store — no breakage expected.

## Acceptance Criteria

- [ ] `coc serve` uses `FileProcessStore` with `~/.coc/` as `dataDir`
- [ ] Processes persist across server restarts
- [ ] `~/.coc/processes.json` is created on first process addition
- [ ] `~/.coc/workspaces.json` is created on first workspace registration
- [ ] Existing tests continue to pass (stub store fallback works)
- [ ] Dashboard shows historical processes on page reload

## Risks / Notes

- `FileProcessStore` reads/writes the entire JSON file on every mutation.
  This is acceptable for the expected process volume (<500 entries, enforced
  by pruning) but would need revisiting if volume grows significantly.
- Atomic writes use rename (`tmp → final`), which is safe on all platforms
  as long as the tmp file is on the same filesystem as the target — both are
  in `dataDir`, so this is guaranteed.
- The `onProcessChange` callback is set by `createExecutionServer()` after
  store creation (line 149 of `index.ts`). `FileProcessStore` supports this
  via its `onProcessChange?` property — no timing issue.
