# Fix Windows Path Separator in Queue User Messages

## Problem

When the CoC SPA dashboard queues a "Follow Prompt" task on Windows, the file path in the user message uses **forward slashes** (e.g., `D:/projects/shortcuts/.vscode/tasks/coc/git/file.plan.md`) instead of **backslashes** (`D:\projects\shortcuts\.vscode\tasks\coc\git\file.plan.md`).

This happens because the dialog code explicitly calls `toForwardSlashes()` on the path before sending it. On Windows, the AI agent (Copilot CLI) is instructed to use native backslash paths, so the path should respect the OS convention.

## Root Cause

Three locations explicitly convert paths to forward slashes:

1. **`FollowPromptDialog.tsx`** (lines 90, 96) — converts `planFilePath` and `promptFilePath` using `toForwardSlashes()`
2. **`BulkFollowPromptDialog.tsx`** (lines 129, 137) — same pattern for bulk task queueing
3. **`queue-executor-bridge.ts`** (line 956) — converts the CONTEXT.md path in `findContextFileSuffix()`

The `toForwardSlashes()` from `path-utils.ts` simply replaces all `\` with `/`. The working directory from the workspace (`ws.rootPath`) already carries the OS-native separator (e.g., `D:\projects\shortcuts` on Windows), but this gets overridden.

## Approach

Add a `toNativePath()` utility to `path-utils.ts` that detects whether a path is Windows-style (starts with a drive letter like `C:`) and normalizes all slashes accordingly. Replace `toForwardSlashes` with `toNativePath` in the three affected locations.

This is browser-safe (no Node.js `path` dependency) since it uses simple regex detection.

## Changes

### 1. Add `toNativePath` to `pipeline-core/src/utils/path-utils.ts`

```typescript
/**
 * Normalize slashes to match the OS style detected from the path.
 * Windows paths (starting with drive letter) get backslashes; others get forward slashes.
 */
export function toNativePath(p: string): string {
    if (/^[A-Za-z]:/.test(p)) {
        return p.replace(/\//g, '\\');
    }
    return toForwardSlashes(p);
}
```

### 2. Export `toNativePath` from `pipeline-core/src/utils/index.ts` and `pipeline-core/src/index.ts`

### 3. Update `FollowPromptDialog.tsx`

- Replace `import { toForwardSlashes }` with `import { toNativePath }`
- Line 90: `toForwardSlashes(...)` → `toNativePath(...)`
- Line 96: `toForwardSlashes(...)` → `toNativePath(...)`

### 4. Update `BulkFollowPromptDialog.tsx`

- Replace `import { toForwardSlashes }` with `import { toNativePath }`
- Line 129: `toForwardSlashes(...)` → `toNativePath(...)`
- Line 137: `toForwardSlashes(...)` → `toNativePath(...)`

### 5. Update `queue-executor-bridge.ts`

- Line 956: `toForwardSlashes(contextPath)` → `toNativePath(contextPath)` (import change too)

### 6. Add tests for `toNativePath` in the existing path-utils test file
