# Fix Windows Path Regression in Queue Task Prompts

## Problem

On Windows, the AI queue task prompts display paths with **mixed separators** (both `\` and `/`). From the screenshot:

```
Use the impl skill. D:\projects\shortcuts/.vscode/tasks/coc\migrate-task-types/001-generify-pipeline-core-queue-types.md
See context details in D:/projects/shortcuts/.vscode/tasks/coc/migrate-task-types/CONTEXT.md
```

- **Line 1** (`planFilePath`): Mixed `\` and `/` — `D:\projects\shortcuts` (native) + `/.vscode/tasks/` (forward) + `coc\migrate-task-types` (native) + `/001-...` (forward)
- **Line 2** (`CONTEXT.md`): Consistently forward-slash — because `findContextFileSuffix` applies `toForwardSlashes()`

## Root Cause

Three layers contribute to the mixed-separator paths:

### 1. Client-side path construction (primary cause)

In `FollowPromptDialog.tsx` (line 88-90), `BulkFollowPromptDialog.tsx` (line 127-129), and `UpdateDocumentDialog.tsx` (line 61-62):

```typescript
const planFilePath = workingDirectory + '/' + tasksFolder + '/' + taskPath;
```

- `workingDirectory` = `ws.rootPath` → on Windows has native `\` (e.g., `D:\projects\shortcuts`)
- `tasksFolder` / `taskPath` → may have forward or backslashes depending on source
- String concatenation with `'/'` creates mixed-separator paths

### 2. Server-side prompt construction (inconsistent normalization)

In `queue-executor-bridge.ts`, `extractPrompt()` uses `planFilePath` and `promptFilePath` **directly** in prompt strings (lines 521, 531, 546) without normalization. Meanwhile, `findContextFileSuffix()` (line 951) correctly normalizes with `toForwardSlashes()`.

### 3. VS Code extension path construction

In `ai-queue-service.ts`, `buildFollowPromptText()` (lines 108-112) also uses `planFilePath` and `promptFilePath` directly without normalization.

## Fix

### Approach: Normalize at both client and server boundaries

Since `toForwardSlashes` is already available in both environments, apply it consistently.

### Task 1: Normalize paths in FollowPromptDialog.tsx ✅

**File:** `packages/coc/src/server/spa/client/react/shared/FollowPromptDialog.tsx`

- Import `toForwardSlashes` from `@plusplusoneplusplus/pipeline-core/utils/path-utils`
- Apply `toForwardSlashes()` to the constructed `planFilePath` and `promptFilePath` before sending to server

### Task 2: Normalize paths in BulkFollowPromptDialog.tsx ✅

**File:** `packages/coc/src/server/spa/client/react/shared/BulkFollowPromptDialog.tsx`

- Same fix as Task 1

### Task 3: Normalize paths in UpdateDocumentDialog.tsx ✅

**File:** `packages/coc/src/server/spa/client/react/shared/UpdateDocumentDialog.tsx`

- Same fix as Task 1

### Task 4: Normalize paths in queue-executor-bridge.ts (defense in depth) ✅

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

- In `extractPrompt()`, normalize `task.payload.planFilePath` and `task.payload.promptFilePath` with `toForwardSlashes()` before embedding in prompt strings (lines 521, 531, 546)

### Task 5: Normalize paths in ai-queue-service.ts (VS Code extension) ✅

**File:** `src/shortcuts/ai-service/ai-queue-service.ts`

- In `buildFollowPromptText()`, normalize `planFilePath` and `promptFilePath` before embedding in prompt strings

### Task 6: Verify with build ✅

- Run `npm run build` to ensure no compile errors
- Run tests for affected packages

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/shared/FollowPromptDialog.tsx` | Import and apply `toForwardSlashes` to constructed paths |
| `packages/coc/src/server/spa/client/react/shared/BulkFollowPromptDialog.tsx` | Import and apply `toForwardSlashes` to constructed paths |
| `packages/coc/src/server/spa/client/react/shared/UpdateDocumentDialog.tsx` | Import and apply `toForwardSlashes` to constructed paths |
| `packages/coc/src/server/queue-executor-bridge.ts` | Normalize paths in `extractPrompt()` |
| `src/shortcuts/ai-service/ai-queue-service.ts` | Normalize paths in `buildFollowPromptText()` |
