---
status: pending
---

# 005: Wire Image Handling in Task Commands

## Summary

Connect the webview paste-image UI (commit 004) to the SDK attachment plumbing (commits 001–003) by decoding base64 data URLs into temp files, passing them as SDK attachments through the AI invoker, and cleaning them up afterwards.

## Motivation

Commits 001–003 added `attachments` support end-to-end through the SDK types, service, and invoker factory. Commit 004 added the webview UI that collects pasted images and transmits them as `images: string[]` (base64 data URLs) in the `postMessage` payload. This commit is the glue: it extracts those images from the dialog result, materialises them as temp files the SDK can read, threads them into the invoker call, and ensures cleanup regardless of outcome.

## Changes

### Files to Create
- (none — the temp file logic is small enough to live inline in `ai-task-commands.ts`)

### Files to Modify

- **`src/shortcuts/tasks-viewer/ai-task-dialog.ts`** — In `handleMessage()`, extract `message.images` (a `string[]` of base64 data URLs) from the webview `postMessage` and forward it into the `AITaskCreationOptions` result. Specifically:
  - For `create` mode → set `result.createOptions.images = message.images`
  - For `from-feature` mode → set `result.fromFeatureOptions.images = message.images`

- **`src/shortcuts/tasks-viewer/types.ts`** — Add `images?: string[]` to both `AITaskCreateOptions` (line ~190) and `AITaskFromFeatureOptions` (line ~206).

- **`src/shortcuts/tasks-viewer/ai-task-commands.ts`** — In `executeAITaskCreation()`:
  1. Extract the `images` array from the options.
  2. Decode each base64 data URL into a temp file.
  3. Build the `attachments` array for the invoker.
  4. Pass `attachments` into the `createAIInvoker` options.
  5. Clean up temp files in a `finally` block.

### Files to Delete
- (none)

## Implementation Notes

### 1. Extracting `images` from options (`ai-task-commands.ts`, inside `executeAITaskCreation`)

After line 180 (where `taskName` is set), extract images:

```typescript
const images: string[] = isFromFeature
    ? options.fromFeatureOptions?.images ?? []
    : options.createOptions?.images ?? [];
```

### 2. Base64 data URL parsing

A data URL has the form: `data:<mime>;base64,<data>`

```typescript
function parseDataUrl(dataUrl: string): { mimeType: string; extension: string; buffer: Buffer } | null {
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/);
    if (!match) { return null; }
    const mimeType = match[1];       // e.g. "image/png"
    let extension = match[2];        // e.g. "png"
    // normalise jpeg → jpg
    if (extension === 'jpeg') { extension = 'jpg'; }
    const buffer = Buffer.from(match[3], 'base64');
    return { mimeType, extension, buffer };
}
```

This helper should be a **module-private function** at the top of `ai-task-commands.ts` (not exported — no other file needs it).

### 3. Temp file creation

Use `os.tmpdir()` + a unique prefix to avoid collisions. The project already uses `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` extensively (see `ai-process-manager.ts:1275`, test files).

Strategy: create a single temp directory for the batch, write files into it, and delete the whole directory in cleanup.

```typescript
import * as os from 'os';  // already used elsewhere in the project

async function saveImagesToTempFiles(images: string[]): Promise<{ tempDir: string; filePaths: string[] }> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-task-images-'));
    const filePaths: string[] = [];

    for (let i = 0; i < images.length; i++) {
        const parsed = parseDataUrl(images[i]);
        if (!parsed) { continue; }
        const filePath = path.join(tempDir, `image-${i}.${parsed.extension}`);
        fs.writeFileSync(filePath, parsed.buffer);
        filePaths.push(filePath);
    }

    return { tempDir, filePaths };
}
```

### 4. Cleanup helper

```typescript
function cleanupTempDir(tempDir: string): void {
    try {
        // Remove all files in the temp directory, then the directory itself
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                fs.unlinkSync(path.join(tempDir, file));
            }
            fs.rmdirSync(tempDir);
        }
    } catch {
        // Best-effort cleanup — don't throw on temp file cleanup failure
    }
}
```

Alternatively, use `fs.rmSync(tempDir, { recursive: true, force: true })` (Node 14.14+, which VS Code guarantees). This is simpler:

```typescript
function cleanupTempDir(tempDir: string): void {
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
}
```

### 5. Threading attachments into the invoker call

The core change is at **line ~237** in `executeAITaskCreation()`. Currently:

```typescript
const aiInvoker = createAIInvoker({
    workingDirectory: workspaceRoot,
    model,
    featureName,
    clipboardFallback: false,
    approvePermissions: true,
    processManager,
    cancellationToken: token
});

const result = await aiInvoker(prompt);
```

After the change, wrap the invocation in a try/finally for temp file cleanup:

```typescript
let tempDir: string | undefined;
let attachments: string[] | undefined;

if (images.length > 0) {
    const saved = saveImagesToTempFiles(images);
    tempDir = saved.tempDir;
    attachments = saved.filePaths;
}

try {
    const aiInvoker = createAIInvoker({
        workingDirectory: workspaceRoot,
        model,
        featureName,
        clipboardFallback: false,
        approvePermissions: true,
        processManager,
        cancellationToken: token,
        attachments    // <-- NEW: pass temp file paths as attachments
    });

    const result = await aiInvoker(prompt);
    // ... rest of success/error handling unchanged ...
} finally {
    if (tempDir) {
        cleanupTempDir(tempDir);
    }
}
```

> **Note:** This requires `AIInvokerFactoryOptions.attachments` to exist (from commit 003). The factory forwards `attachments` to `sendMessage()` in the SDK call at `ai-invoker-factory.ts:203`. The exact shape added in commits 001–003 must be `attachments?: string[]` (array of file paths).

### 6. Handling `message.images` in `ai-task-dialog.ts`

In `handleMessage()` (line ~130), the `submit` case builds the `result` object. Add `images` to both branches:

```typescript
if (message.mode === 'create') {
    result.createOptions = {
        name: message.name,
        location: message.location,
        description: message.description,
        model: message.model,
        images: message.images || []   // <-- NEW
    };
} else {
    result.fromFeatureOptions = {
        name: message.name,
        location: message.location,
        focus: message.focus,
        depth: message.depth,
        model: message.model,
        images: message.images || []   // <-- NEW
    };
}
```

### 7. Type changes in `types.ts`

Add to `AITaskCreateOptions`:
```typescript
/** Base64 data URLs of pasted images to include as AI context */
images?: string[];
```

Add to `AITaskFromFeatureOptions`:
```typescript
/** Base64 data URLs of pasted images to include as AI context */
images?: string[];
```

## Tests

### Unit tests (in `src/test/suite/tasks-ai-commands.test.ts` or new file)

1. **`parseDataUrl` — valid PNG data URL** — Returns correct mimeType, extension `png`, and decoded Buffer.
2. **`parseDataUrl` — valid JPEG data URL** — Returns extension `jpg` (normalised from `jpeg`).
3. **`parseDataUrl` — invalid/non-image data URL** — Returns `null`.
4. **`parseDataUrl` — malformed string** — Returns `null`.
5. **`saveImagesToTempFiles` — creates temp directory and files** — Given two valid data URLs, creates a temp dir with two files having correct extensions and content.
6. **`saveImagesToTempFiles` — skips invalid data URLs** — Given a mix of valid and invalid, only valid ones produce files.
7. **`cleanupTempDir` — removes directory and all contents** — After creating a temp dir with files, cleanup removes everything.
8. **`cleanupTempDir` — no-op for non-existent directory** — Does not throw.
9. **Integration: images flow from options to invoker attachments** — Mock `createAIInvoker` and verify that when `images` is non-empty, `attachments` parameter contains temp file paths, and temp files are cleaned up after invocation.

> **Note:** `parseDataUrl`, `saveImagesToTempFiles`, and `cleanupTempDir` should be exported (or the test file can import them with a test-only path) for unit testing. Alternatively, extract them to a small utility and test that. Prefer keeping them module-private and testing through the integration path if the team convention avoids exporting test-only symbols.

## Acceptance Criteria

- [ ] `AITaskCreateOptions.images` and `AITaskFromFeatureOptions.images` typed as `string[] | undefined`
- [ ] `handleMessage()` extracts `message.images` and populates `images` on the correct options branch
- [ ] Base64 data URLs are decoded and saved as temp files with correct extensions (`.png`, `.jpg`, `.gif`, `.webp`)
- [ ] JPEG extension is normalised from `jpeg` to `jpg`
- [ ] Invalid/malformed data URLs are silently skipped (no crash)
- [ ] Temp file paths are passed as `attachments` to `createAIInvoker`
- [ ] Temp files are cleaned up in a `finally` block (both success and failure paths)
- [ ] When `images` is empty or undefined, no temp files are created and `attachments` is undefined
- [ ] End-to-end: pasting an image in the dialog and clicking Generate sends the image as context to the AI

## Dependencies

- Depends on: **003** (AIInvokerFactoryOptions.attachments, forwarded to SDK), **004** (webview sends `images` in postMessage)

## Assumed Prior State

- `SendMessageOptions.attachments` exists in pipeline-core types (commit 001)
- `CopilotSDKService.sendMessage()` forwards `attachments` to the SDK session (commit 002)
- `AIInvokerFactoryOptions.attachments` exists and `createAIInvoker` forwards it to `sendMessage()` (commit 003)
- `AITaskCreateOptions.images` and `AITaskFromFeatureOptions.images` fields exist in types (commit 004 — or this commit adds them; see below)
- The dialog webview sends `images: string[]` (base64 data URLs) in the `postMessage` payload (commit 004 webview HTML)

> **Boundary note:** The `images` field on the TypeScript option types (`AITaskCreateOptions`, `AITaskFromFeatureOptions`) and the `handleMessage` extraction could logically belong to either commit 004 (UI) or commit 005 (wiring). The plan above places them in commit 005 since they are only meaningful when the wiring exists. If commit 004 already added them, skip the type changes and `handleMessage` edits here.
