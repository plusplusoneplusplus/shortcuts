# Resume AI Process for Any Process with Session ID

## Problem Statement

Currently, the "Resume Session" feature in the AI Processes panel only works for two specific process types:
- `clarificationProcess_completed_resumable`
- `pipelineItemProcess_completed(_child)?_resumable`

**User Ask:** Allow resume AI process for **any process** inside the AI processes panel that has a session ID.

## Current Implementation Analysis

### Relevant Files
- `src/shortcuts/ai-service/ai-process-tree-provider.ts` - Sets `contextValue` for tree items
- `src/shortcuts/ai-service/ai-process-manager.ts` - `isProcessResumable()` logic
- `src/extension.ts` (line ~2240) - `clarificationProcesses.resumeSession` command
- `package.json` - Menu contributions with `when` clauses

### Current Resumability Check (`ai-process-manager.ts:680-690`)
```typescript
isProcessResumable(id: string): boolean {
    return !!(
        process.sdkSessionId &&
        process.status === 'completed' &&
        process.backend === 'copilot-sdk'
    );
}
```

### Current Context Value Assignment (`ai-process-tree-provider.ts:37-66`)
Only `clarification` and `pipeline-item` types get `_resumable` suffix:
- `code-review-group` → `codeReviewGroupProcess_${status}` (never resumable)
- `code-review` → `codeReviewProcess_${status}` (never resumable)
- `discovery` → `discoveryProcess_${status}` (never resumable)
- `pipeline-execution` → `pipelineExecutionProcess_${status}` (never resumable)
- `pipeline-item` → `pipelineItemProcess_${status}_resumable` (if resumable)
- `clarification` → `clarificationProcess_${status}_resumable` (if resumable)

### Package.json Menu Contributions (lines ~2291-2297)
```json
{
  "command": "clarificationProcesses.resumeSession",
  "when": "view == clarificationProcessesView && viewItem =~ /^clarificationProcess_completed_resumable$/",
  "group": "process@2"
},
{
  "command": "clarificationProcesses.resumeSession",
  "when": "view == clarificationProcessesView && viewItem =~ /^pipelineItemProcess_completed(_child)?_resumable$/",
  "group": "process@2"
}
```

## Proposed Solution

### Option A: Extend `_resumable` suffix to all process types (Recommended)
Add resumable check for all process types, not just `clarification` and `pipeline-item`.

### Option B: Use a universal `_resumable` suffix pattern
Create a single `when` clause that matches any `*_resumable` context value.

### Recommendation
**Go with Option A + Option B combined:**
1. Extend the tree provider to add `_resumable` suffix to ALL process types when they meet resumability criteria
2. Simplify package.json to use a single regex pattern matching any resumable context

## Implementation Plan

### 1. Update `ai-process-tree-provider.ts`
- [x] Add `isProcessResumable()` check for `code-review-group` type
- [x] Add `isProcessResumable()` check for `code-review` type  
- [x] Add `isProcessResumable()` check for `discovery` type
- [x] Add `isProcessResumable()` check for `pipeline-execution` type
- [x] Ensure consistent `_resumable` suffix pattern across all types

### 2. Update `package.json` menu contributions
- [x] Replace the two specific `when` clauses with a single pattern: `viewItem =~ /_completed(_child)?_resumable$/`
- [x] This will match any process type ending with `_completed_resumable` or `_completed_child_resumable`

### 3. Verify command handler compatibility
- [x] Review `clarificationProcesses.resumeSession` command in `extension.ts`
- [x] Ensure it works for all process types (it should, since it uses `aiProcessManager.isProcessResumable()`)

### 4. Testing
- [x] Test resume on clarification process (existing)
- [x] Test resume on pipeline-item process (existing)
- [x] Test resume on code-review process with session ID (new)
- [x] Test resume on code-review-group process with session ID (new)
- [x] Test resume on discovery process with session ID (new)
- [x] Test resume on pipeline-execution process with session ID (new)
- [x] Verify non-resumable processes don't show resume option

## Code Changes

### `ai-process-tree-provider.ts` Changes

**Before (code-review-group):**
```typescript
if (process.type === 'code-review-group') {
    this.contextValue = `codeReviewGroupProcess_${process.status}`;
}
```

**After:**
```typescript
if (process.type === 'code-review-group') {
    const isResumable = this.isProcessResumable(process);
    this.contextValue = isResumable
        ? `codeReviewGroupProcess_${process.status}_resumable`
        : `codeReviewGroupProcess_${process.status}`;
}
```

Apply similar changes to:
- `code-review` type
- `discovery` type
- `pipeline-execution` type

### `package.json` Changes

**Before:**
```json
{
  "command": "clarificationProcesses.resumeSession",
  "when": "view == clarificationProcessesView && viewItem =~ /^clarificationProcess_completed_resumable$/",
  "group": "process@2"
},
{
  "command": "clarificationProcesses.resumeSession",
  "when": "view == clarificationProcessesView && viewItem =~ /^pipelineItemProcess_completed(_child)?_resumable$/",
  "group": "process@2"
}
```

**After:**
```json
{
  "command": "clarificationProcesses.resumeSession",
  "when": "view == clarificationProcessesView && viewItem =~ /_completed(_child)?_resumable$/",
  "group": "process@2"
}
```

## Backward Compatibility

✅ **Fully backward compatible:**
- Existing resumable processes will continue to work
- The `isProcessResumable()` logic in `ai-process-manager.ts` remains unchanged
- The command handler in `extension.ts` already supports any process type

## Risk Assessment

**Low Risk:**
- Changes are additive (extending existing pattern)
- Core resumability logic unchanged
- No breaking changes to existing functionality

## Notes

- Session ID attachment happens via `attachSdkSessionId()` method
- Backend type is stored via `attachSessionMetadata()` method
- Not all process types may currently store session metadata - this plan enables resume for those that do
