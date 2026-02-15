---
status: pending
priority: high
depends_on:
  - 002-wire-file-process-store
---

# 003 — Persist Full Conversation Output Per Process to Disk

## Problem

Streaming output (AI response chunks) is only held in-memory via `EventEmitter` in `FileProcessStore.emitProcessOutput`. Once a process completes or the server restarts, the full conversation text is gone. Users need to review completed task conversations after the fact.

## Goal

Save the full accumulated AI conversation output to disk as a Markdown file so it survives process completion and server restarts.

## Current Behaviour

1. `CLITaskExecutor.executeWithAI()` calls `sdkService.sendMessage()` with an `onStreamingChunk` callback.
2. Each chunk is forwarded to `this.store.emitProcessOutput(processId, chunk)`.
3. `FileProcessStore.emitProcessOutput` fires an in-memory `EventEmitter` event — consumed by SSE (`sse-handler.ts`) and WebSocket listeners.
4. When the process completes, `emitProcessComplete` is called and the per-process emitter is deleted.
5. **No chunk data is persisted.** The `AIProcess.rawStdoutFilePath` field exists on the type but is never populated.

## Design

### 1. Output Accumulator in `CLITaskExecutor`

In `queue-executor-bridge.ts`, inside `executeWithAI()`:

- Declare a `let outputBuffer = ''` before the `sendMessage` call.
- In the `onStreamingChunk` callback, **append** the chunk to `outputBuffer` in addition to the existing `emitProcessOutput` call.
- After `sendMessage` resolves (success or failure), write the accumulated buffer to disk and store the file path on the process.

```typescript
// Inside executeWithAI(), before sendMessage:
let outputBuffer = '';

// In onStreamingChunk callback:
onStreamingChunk: (chunk: string) => {
    outputBuffer += chunk;
    try {
        this.store.emitProcessOutput(processId, chunk);
    } catch {
        // Non-fatal
    }
},

// After sendMessage resolves (in both success and error paths):
const outputPath = await OutputFileManager.saveOutput(processId, outputBuffer, this.dataDir);
if (outputPath) {
    await this.store.updateProcess(processId, { rawStdoutFilePath: outputPath });
}
```

### 2. `OutputFileManager` Helper

Create a new file `packages/coc/src/server/output-file-manager.ts` (or add to an existing utils module):

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

const OUTPUTS_SUBDIR = 'outputs';

export class OutputFileManager {
    /**
     * Write full conversation output to ~/.coc/outputs/<processId>.md
     * Creates the outputs/ directory on first write.
     * Returns the absolute file path, or undefined on failure.
     */
    static async saveOutput(processId: string, content: string, dataDir: string): Promise<string | undefined> {
        if (!content) { return undefined; }
        const dir = path.join(dataDir, OUTPUTS_SUBDIR);
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${processId}.md`);
        await fs.writeFile(filePath, content, 'utf-8');
        return filePath;
    }

    /**
     * Read a previously saved output file.
     * Returns the content string, or undefined if the file doesn't exist.
     */
    static async loadOutput(filePath: string): Promise<string | undefined> {
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch {
            return undefined;
        }
    }

    /**
     * Delete a saved output file (cleanup helper).
     */
    static async deleteOutput(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
        } catch {
            // Ignore if already deleted
        }
    }
}
```

### 3. Wire `dataDir` into `CLITaskExecutor`

- Add an optional `dataDir` property to `CLITaskExecutor` constructor options (default: `getDefaultDataDir()` from `pipeline-core`).
- Pass through from `QueueExecutorBridgeOptions` → `CLITaskExecutor`.
- This directory is the same `~/.coc/` already used by `FileProcessStore`.

### 4. Persist on Both Success and Failure

The output file is written in a `finally`-style block so conversations from failed tasks are also saved — useful for debugging.

```
try {
    const result = await this.executeByType(task, prompt);
    // ... update store as completed
} catch (error) {
    // ... update store as failed
} finally {
    if (outputBuffer) {
        const outputPath = await OutputFileManager.saveOutput(processId, outputBuffer, this.dataDir);
        if (outputPath) {
            await this.store.updateProcess(processId, { rawStdoutFilePath: outputPath });
        }
    }
}
```

Placing the write in `finally` keeps both the success and error branches clean.

## Files Changed

| File | Change |
|---|---|
| `packages/coc/src/server/output-file-manager.ts` | **New** — `OutputFileManager` with `saveOutput`, `loadOutput`, `deleteOutput` static methods |
| `packages/coc/src/server/queue-executor-bridge.ts` | Add `outputBuffer` accumulator in `executeWithAI`; write to disk after completion; accept `dataDir` option |
| `packages/coc/src/server/queue-executor-bridge.ts` | Add `dataDir` to `QueueExecutorBridgeOptions` and pass to `CLITaskExecutor` |

## Files NOT Changed

| File | Reason |
|---|---|
| `packages/pipeline-core/src/ai/process-types.ts` | `rawStdoutFilePath` already exists on `AIProcess` — no type changes needed |
| `packages/pipeline-core/src/file-process-store.ts` | `emitProcessOutput` unchanged — still fires in-memory events for SSE/WS |
| `packages/coc/src/server/sse-handler.ts` | SSE streaming is unaffected — it reads from the same `emitProcessOutput` events |

## Tests

Add test file `packages/coc/test/output-file-manager.test.ts`:

1. **`saveOutput` writes file to correct path** — call `saveOutput('proc-1', 'hello world', tmpDir)`, assert file exists at `<tmpDir>/outputs/proc-1.md` with correct content.
2. **`saveOutput` creates outputs/ directory** — call on a fresh temp dir, assert directory was created.
3. **`saveOutput` returns undefined for empty content** — pass empty string, assert returns `undefined` and no file written.
4. **`loadOutput` reads saved file** — save then load, assert content matches.
5. **`loadOutput` returns undefined for missing file** — assert returns `undefined`, no throw.
6. **`deleteOutput` removes file** — save, delete, assert file gone.
7. **`deleteOutput` is no-op for missing file** — assert no throw.

Add tests in `packages/coc/test/queue-executor-bridge.test.ts` (extend existing or new section):

8. **Streaming output is accumulated and saved to file** — mock `sendMessage` to emit chunks via `onStreamingChunk`, assert output file contains concatenated chunks.
9. **`rawStdoutFilePath` is set on the process after completion** — after task execution, fetch process from store and assert `rawStdoutFilePath` is defined and points to existing file.
10. **Output file saved on task failure too** — mock `sendMessage` to emit chunks then throw, assert output file still written.
11. **SSE/WS streaming still receives chunks** — subscribe to `store.onProcessOutput`, execute task, assert chunks received in real-time alongside file persistence.

## Acceptance Criteria

- [ ] Full AI conversation text saved to `~/.coc/outputs/<id>.md`
- [ ] `AIProcess.rawStdoutFilePath` points to the output file after task completion
- [ ] Output file is readable after server restart (persisted to disk)
- [ ] Streaming to WebSocket/SSE clients still works (not broken by accumulator)
- [ ] Output file is also written for failed tasks
- [ ] `OutputFileManager` has full create/read/delete cycle
- [ ] All new and existing tests pass on Linux, macOS, and Windows
