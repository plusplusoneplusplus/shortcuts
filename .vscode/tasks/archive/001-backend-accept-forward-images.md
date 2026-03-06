---
status: done
commit: "001"
title: "Backend: accept and forward image attachments"
---

# 001 — Backend: accept and forward image attachments

## Summary

Extend the POST `/api/processes/:id/message` endpoint and the executor bridge
to accept optional base64 images in the request body, decode them to temp files
on disk, and pass them as SDK `Attachment[]` to the AI service. Also extend the
queue POST endpoint for the initial chat message.

## Motivation

The SDK plumbing (`Attachment` type, `sendMessage({ attachments })`,
`sendFollowUp({ attachments })`) is fully wired in `pipeline-core`. The CoC
backend just doesn't accept or forward images yet. This commit closes that gap
at the API + executor layer.

---

## Prior-state snapshot (line numbers at time of writing)

| File | Key location | What's there now |
|------|-------------|-----------------|
| `packages/coc-server/src/api-handler.ts:28-31` | `QueueExecutorBridge` interface | `executeFollowUp(processId: string, message: string): Promise<void>` — no `attachments` param |
| `packages/coc-server/src/api-handler.ts:611-675` | POST `/api/processes/:id/message` handler | Reads `body.content`; calls `bridge.executeFollowUp(id, body.content)` — no image handling |
| `packages/coc/src/server/queue-executor-bridge.ts:75-79` | `QueueExecutorBridge` interface (coc-side mirror) | Same — `executeFollowUp(processId, message)` with no attachments |
| `packages/coc/src/server/queue-executor-bridge.ts:300-444` | `CLITaskExecutor.executeFollowUp()` | Calls `this.aiService.sendFollowUp(sdkSessionId, message, { ... })` — no attachments passed |
| `packages/coc/src/server/queue-executor-bridge.ts:560-643` | `CLITaskExecutor.executeWithAI()` | Calls `this.aiService.sendMessage({ prompt, ... })` — no attachments passed |
| `packages/coc/src/server/multi-repo-executor-bridge.ts:139-146` | `MultiRepoQueueExecutorBridge.executeFollowUp()` | Passthrough: `bridge.executeFollowUp(processId, message)` — no attachments |
| `packages/coc/src/server/queue-handler.ts:126-184` | `validateAndParseTask()` | Promotes `prompt` and `workingDirectory` into payload — no `images` promotion |
| `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts:173-180` | `Attachment` interface | `{ type: 'file' \| 'directory'; path: string; displayName?: string }` — exists, ready to use |
| `packages/pipeline-core/src/copilot-sdk-wrapper/copilot-sdk-service.ts:91-109` | `SendFollowUpOptions` | Has `attachments?: Attachment[]` — already wired |
| `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts:210` | `SendMessageOptions.attachments` | Has `attachments?: Attachment[]` — already wired |
| `src/shortcuts/tasks-viewer/ai-task-commands.ts:30-64` | `parseDataUrl`, `saveImagesToTempFiles`, `cleanupTempDir` | Reference implementation (VS Code extension side) — pattern to replicate |

---

## Changes

### 1. NEW FILE — `packages/coc-server/src/image-utils.ts`

Shared image utilities, pure Node.js (no VS Code deps). Replicates the logic
from `src/shortcuts/tasks-viewer/ai-task-commands.ts:30-64` adapted for server
context.

```ts
// packages/coc-server/src/image-utils.ts

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Attachment } from '@plusplusoneplusplus/pipeline-core';

/**
 * Parse a base64 data URL into its components.
 * Returns null for invalid or non-image data URLs.
 */
export function parseDataUrl(
    dataUrl: string,
): { mimeType: string; extension: string; buffer: Buffer } | null {
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/s);
    if (!match) { return null; }
    const mimeType = match[1];
    let extension = match[2];
    if (extension === 'jpeg') { extension = 'jpg'; }
    try {
        const buffer = Buffer.from(match[3], 'base64');
        return { mimeType, extension, buffer };
    } catch {
        return null;
    }
}

/**
 * Decode base64 data URL images into temp files for SDK attachment.
 * Creates a single temp directory containing all image files.
 * Returns empty arrays if all images are invalid (never throws).
 */
export function saveImagesToTempFiles(
    images: string[],
): { tempDir: string; attachments: Attachment[] } {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-images-'));
    const attachments: Attachment[] = [];

    for (let i = 0; i < images.length; i++) {
        const parsed = parseDataUrl(images[i]);
        if (!parsed) { continue; }
        const filePath = path.join(tempDir, `image-${i}.${parsed.extension}`);
        fs.writeFileSync(filePath, parsed.buffer);
        attachments.push({ type: 'file', path: filePath });
    }

    return { tempDir, attachments };
}

/** Best-effort cleanup of a temp directory and its contents. */
export function cleanupTempDir(tempDir: string): void {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
}
```

**Key differences from the VS Code reference:**
- `saveImagesToTempFiles` returns `Attachment[]` directly (not raw file paths) — callers don't need to map.
- `parseDataUrl` wraps `Buffer.from()` in try/catch to guard against corrupted base64 data.
- Temp dir prefix is `coc-images-` (not `ai-task-images-`) for server-side clarity.

**Export from package:** Add to `packages/coc-server/src/index.ts`:
```ts
export { parseDataUrl, saveImagesToTempFiles, cleanupTempDir } from './image-utils';
```

---

### 2. MODIFY — `packages/coc-server/src/api-handler.ts`

#### 2a. Add import (top of file, after line 18)

```ts
import type { Attachment } from '@plusplusoneplusplus/pipeline-core';
import { saveImagesToTempFiles, cleanupTempDir } from './image-utils';
```

#### 2b. Update `QueueExecutorBridge` interface (line 28-31)

**Before (line 28-31):**
```ts
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
}
```

**After:**
```ts
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[]): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
}
```

Single-line change: add `attachments?: Attachment[]` as third parameter.

#### 2c. Update POST `/api/processes/:id/message` handler (lines 611-675)

**Current flow (line 667):**
```ts
bridge.executeFollowUp(id, body.content).catch(() => { ... });
```

**New flow — insert image handling after the `body.content` validation (after line 633), before the session liveness check:**

After the existing `body.content` validation block (line 631-633), add:

```ts
// Decode optional base64 images to temp files
let attachments: Attachment[] | undefined;
let imageTempDir: string | undefined;
if (Array.isArray(body.images) && body.images.length > 0) {
    // Filter to only valid strings, cap at 10 images
    const validImages = body.images
        .filter((img: unknown) => typeof img === 'string')
        .slice(0, 10);
    if (validImages.length > 0) {
        const result = saveImagesToTempFiles(validImages);
        imageTempDir = result.tempDir;
        attachments = result.attachments.length > 0 ? result.attachments : undefined;
    }
}
```

Then update the fire-and-forget call (replacing line 667-669):

```ts
// Delegate AI execution to the queue executor bridge (fire-and-forget)
bridge.executeFollowUp(id, body.content, attachments).catch(() => {
    // Error handling is done inside executeFollowUp
}).finally(() => {
    // Clean up temp image files
    if (imageTempDir) { cleanupTempDir(imageTempDir); }
});
```

**Note:** The `.finally()` cleanup fires after the executeFollowUp promise
settles. Because `executeFollowUp` is awaited internally before the SDK call
completes, the temp files remain on disk for the full duration of the AI
request.

---

### 3. MODIFY — `packages/coc/src/server/queue-executor-bridge.ts`

#### 3a. Add import (near top, after existing pipeline-core imports at line 47)

```ts
import type { Attachment } from '@plusplusoneplusplus/pipeline-core';
```

Check whether `Attachment` is already re-exported from the existing pipeline-core
import on line 47. If so, just add it to the existing `import type { ... }` list.

#### 3b. Update `QueueExecutorBridge` interface (line 75-79)

**Before (line 76):**
```ts
executeFollowUp(processId: string, message: string): Promise<void>;
```

**After:**
```ts
executeFollowUp(processId: string, message: string, attachments?: Attachment[]): Promise<void>;
```

#### 3c. Update `CLITaskExecutor.executeFollowUp` method (line 300)

**Before (line 300):**
```ts
async executeFollowUp(processId: string, message: string): Promise<void> {
```

**After:**
```ts
async executeFollowUp(processId: string, message: string, attachments?: Attachment[]): Promise<void> {
```

Then update the `sendFollowUp` call (line 319) to pass attachments:

**Before (line 319-372):**
```ts
const result = await this.aiService.sendFollowUp(process.sdkSessionId, message, {
    workingDirectory,
    onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
    onStreamingChunk: (chunk: string) => { ... },
    onToolEvent: (event: ToolEvent) => { ... },
});
```

**After — add `attachments` to the options object:**
```ts
const result = await this.aiService.sendFollowUp(process.sdkSessionId, message, {
    workingDirectory,
    onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
    attachments,
    onStreamingChunk: (chunk: string) => { ... },
    onToolEvent: (event: ToolEvent) => { ... },
});
```

Single insertion: `attachments,` after the `onPermissionRequest` line (after line 321).

#### 3d. Update `CLITaskExecutor.executeWithAI` method (line 560-643)

Add import for image utils at top (or inline):

```ts
import { saveImagesToTempFiles, cleanupTempDir } from '@plusplusoneplusplus/coc-server';
```

In `executeWithAI` (line 560), after `this.outputBuffers.set(processId, '')` (line 564) and before the availability check (line 566):

```ts
// Decode optional base64 images from payload
let attachments: Attachment[] | undefined;
let imageTempDir: string | undefined;
const payloadImages = (task.payload as any)?.images;
if (Array.isArray(payloadImages) && payloadImages.length > 0) {
    const validImages = payloadImages.filter((img: unknown) => typeof img === 'string').slice(0, 10);
    if (validImages.length > 0) {
        const result = saveImagesToTempFiles(validImages);
        imageTempDir = result.tempDir;
        attachments = result.attachments.length > 0 ? result.attachments : undefined;
    }
}
```

Then update the `sendMessage` call (line 574) to pass `attachments`:

**Before (line 574-633):**
```ts
const result = await this.aiService.sendMessage({
    prompt,
    model: task.config.model,
    workingDirectory,
    timeoutMs,
    keepAlive: true,
    onPermissionRequest: ...,
    onStreamingChunk: ...,
    onToolEvent: ...,
});
```

**After — add `attachments` field:**
```ts
const result = await this.aiService.sendMessage({
    prompt,
    model: task.config.model,
    workingDirectory,
    timeoutMs,
    keepAlive: true,
    attachments,
    onPermissionRequest: ...,
    onStreamingChunk: ...,
    onToolEvent: ...,
});
```

And wrap the entire method body after image decoding in try/finally for cleanup:

```ts
try {
    // ... existing availability check, sendMessage, etc. ...
} finally {
    if (imageTempDir) { cleanupTempDir(imageTempDir); }
}
```

---

### 4. MODIFY — `packages/coc/src/server/multi-repo-executor-bridge.ts`

#### 4a. Add import (near top, after existing pipeline-core imports at line 19)

```ts
import type { Attachment } from '@plusplusoneplusplus/pipeline-core';
```

(Or add `Attachment` to the existing `import type { ... }` on line 19 if it fits.)

#### 4b. Update `executeFollowUp` passthrough (lines 139-146)

**Before (line 139):**
```ts
async executeFollowUp(processId: string, message: string): Promise<void> {
    for (const { bridge } of this.bridges.values()) {
        if (await bridge.isSessionAlive(processId)) {
            return bridge.executeFollowUp(processId, message);
        }
    }
    throw new Error(`No active session found for process ${processId}`);
}
```

**After:**
```ts
async executeFollowUp(processId: string, message: string, attachments?: Attachment[]): Promise<void> {
    for (const { bridge } of this.bridges.values()) {
        if (await bridge.isSessionAlive(processId)) {
            return bridge.executeFollowUp(processId, message, attachments);
        }
    }
    throw new Error(`No active session found for process ${processId}`);
}
```

Two-line change: add `attachments` parameter + forward it.

---

### 5. MODIFY — `packages/coc/src/server/queue-handler.ts`

#### 5a. Update `validateAndParseTask` (line 126-184)

After the `workingDirectory` promotion block (lines 150-153), add an `images`
promotion block:

```ts
// Promote top-level images into payload when not already present
if (Array.isArray(taskSpec.images) && taskSpec.images.length > 0 && !payload.images) {
    payload.images = taskSpec.images.filter((img: unknown) => typeof img === 'string');
}
```

This places `images` into `payload.images` so `executeWithAI` can read it as
`task.payload.images`.

**No other changes needed** in `queue-handler.ts`. The payload flows through
the existing `CreateTaskInput` and `QueuedTask` types, which carry an
`any`-typed `payload` object. The `images` array is carried opaquely.

---

### 6. MODIFY — `packages/coc-server/src/index.ts`

Add exports for the new image utilities. After the existing `api-handler`
exports block (around line 82):

```ts
// Image utilities
export { parseDataUrl, saveImagesToTempFiles, cleanupTempDir } from './image-utils';
```

---

## Tests

### Test file 1 — `packages/coc-server/test/image-utils.test.ts` (NEW)

Unit tests for the three exported functions:

| Test | What it verifies |
|------|-----------------|
| `parseDataUrl` — valid PNG data URL | Returns `{ mimeType: 'image/png', extension: 'png', buffer }` |
| `parseDataUrl` — valid JPEG with `jpeg` extension | Returns extension normalized to `jpg` |
| `parseDataUrl` — non-image data URL (`data:text/plain;base64,...`) | Returns `null` |
| `parseDataUrl` — empty string | Returns `null` |
| `parseDataUrl` — malformed base64 body | Returns `null` (no throw) |
| `saveImagesToTempFiles` — two valid images | Creates temp dir with 2 files; returns 2 `Attachment` objects with `type: 'file'` and existing paths |
| `saveImagesToTempFiles` — mix of valid + invalid | Only valid images produce files; attachments array length matches valid count |
| `saveImagesToTempFiles` — all invalid | Returns empty `attachments` array; temp dir still exists but is empty |
| `cleanupTempDir` — removes directory | After calling, `fs.existsSync(tempDir)` is `false` |
| `cleanupTempDir` — non-existent path | Does not throw |

### Test file 2 — integration in existing api-handler tests

Add test cases to the existing test infrastructure (or create
`packages/coc-server/test/api-handler-images.test.ts`):

| Test | What it verifies |
|------|-----------------|
| POST `/api/processes/:id/message` with `images: [validDataUrl]` | `bridge.executeFollowUp` called with `attachments` array of length 1 |
| POST `/api/processes/:id/message` without `images` | `bridge.executeFollowUp` called with `attachments` as `undefined` |
| POST `/api/processes/:id/message` with `images: []` | `bridge.executeFollowUp` called with `attachments` as `undefined` |
| POST `/api/processes/:id/message` with `images: [invalidDataUrl]` | `bridge.executeFollowUp` called with `attachments` as `undefined` (graceful skip) |

### Test file 3 — `packages/coc/test/server/queue-handler-images.test.ts` (NEW or extend existing)

| Test | What it verifies |
|------|-----------------|
| `validateAndParseTask` with `images: [url1, url2]` | `input.payload.images` is `[url1, url2]` |
| `validateAndParseTask` with `images: []` | `payload.images` is not set |
| `validateAndParseTask` without `images` | `payload.images` is not set |
| `validateAndParseTask` with `images: [123, null, 'valid']` | `payload.images` is `['valid']` (non-strings filtered) |

---

## Acceptance criteria

- [ ] POST `/api/processes/:id/message` accepts optional `images: string[]` (base64 data URLs)
- [ ] Images are decoded to temp files, passed as SDK `Attachment[]`, and cleaned up after
- [ ] POST `/api/queue` accepts optional `images: string[]` for initial chat messages (promoted into `payload.images`)
- [ ] `executeFollowUp` signature updated across all 3 files:
  - `packages/coc-server/src/api-handler.ts` — `QueueExecutorBridge` interface
  - `packages/coc/src/server/queue-executor-bridge.ts` — interface + `CLITaskExecutor` implementation
  - `packages/coc/src/server/multi-repo-executor-bridge.ts` — `MultiRepoQueueExecutorBridge` passthrough
- [ ] `executeWithAI` in `queue-executor-bridge.ts` reads `task.payload.images`, decodes, passes as `attachments`, cleans up
- [ ] Existing behavior unchanged when `images` is absent or empty
- [ ] All existing tests still pass
- [ ] New unit tests pass for `parseDataUrl`, `saveImagesToTempFiles`, `cleanupTempDir`
- [ ] New integration tests pass for the message endpoint with images

## Dependencies

None — this is the first commit in the series.

## Assumed prior state

- `Attachment` type exists at `packages/pipeline-core/src/copilot-sdk-wrapper/types.ts:173-180`
- `SendMessageOptions.attachments` exists at `types.ts:210`
- `SendFollowUpOptions.attachments` exists at `copilot-sdk-service.ts:108-109`
- `sendFollowUp` in `CopilotSDKService` already forwards attachments at line 803
- `sendMessage` in `CopilotSDKService` already forwards attachments at line 607/613
