# Fix Mixed Slashes in Plan File Path on Windows

## Problem

The CoC dashboard's Queue detail view shows `planFilePath` with mixed slashes on Windows (e.g., `D:\projects\shortcuts/.vscode/tasks/coc\pipeline\dag-visualization/006-node-interaction.md`). This happens because `workingDirectory` arrives with backslashes (Windows native) and is concatenated with forward-slash `/` separators.

## Root Cause

Three client-side dialog files construct `planFilePath` by string concatenation:

```typescript
const planFilePath = workingDirectory
    ? workingDirectory + '/' + tasksFolder + '/' + taskPath
    : taskPath;
```

When `workingDirectory` is `D:\projects\shortcuts`, the result mixes `\` and `/`.

## Approach

Use the existing `toForwardSlashes()` utility from `@plusplusoneplusplus/pipeline-core/utils/path-utils` (already used elsewhere in the SPA client code, e.g., `file-path-preview.ts`) to normalize the constructed path.

## Todos

### 1. Fix FollowPromptDialog.tsx
- [x] **File:** `packages/coc/src/server/spa/client/react/shared/FollowPromptDialog.tsx`
- Import `toForwardSlashes` from `@plusplusoneplusplus/pipeline-core/utils/path-utils`
- Wrap the `planFilePath` construction with `toForwardSlashes()`

### 2. Fix BulkFollowPromptDialog.tsx
- [x] **File:** `packages/coc/src/server/spa/client/react/shared/BulkFollowPromptDialog.tsx`
- Same import + wrap pattern

### 3. Fix UpdateDocumentDialog.tsx
- [x] **File:** `packages/coc/src/server/spa/client/react/shared/UpdateDocumentDialog.tsx`
- Same import + wrap pattern

### 4. Build & verify
- [x] Run `npm run build` to confirm no build errors
- [x] Run tests in `packages/coc` to confirm no regressions

## Notes

- `toForwardSlashes` is a one-liner: `p.replace(/\\/g, '/')` — safe and well-tested
- The `workingDirectory` field itself (shown separately) also has backslashes, but that reflects the OS-native path which is expected; the issue is specifically the *mixed* slashes in the constructed plan file path
