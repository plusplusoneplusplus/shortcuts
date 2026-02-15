---
status: pending
commit: "004"
title: Enhance follow-prompt executor with context support
---

# 004 — Enhance Follow-Prompt Executor with Context Support

## Goal

Make `CLITaskExecutor.extractPrompt()` use the **existing** `additionalContext` field on `FollowPromptPayload` to prepend a structured context block to prompts. Also add support for reading `planFilePath` as a file (reading its content) instead of just appending the path string. When neither field is provided, behavior is identical to today (fully backward compatible).

**No type changes needed** — `FollowPromptPayload` in `packages/pipeline-core/src/queue/types.ts` already has `additionalContext?: string`, `planFilePath?: string`, and all other required fields.

## Context

The `additionalContext` field already exists on `FollowPromptPayload` (line 56 of `types.ts`) and the executor already appends it as a flat string suffix (`\n\nAdditional context: ${additionalContext}`). This commit upgrades that handling to:

1. **Prepend** `additionalContext` as a structured context block with a separator, so the AI model sees context before the instruction.
2. **Read `planFilePath`** contents (if the file exists) and include them in the context block, instead of just appending the raw file path string.

## Relevant Source (read before implementing)

| File | Lines | What to look at |
|---|---|---|
| `packages/pipeline-core/src/queue/types.ts` | 47–60 | `FollowPromptPayload` interface — already has `additionalContext?: string`, `planFilePath?: string`. **No changes needed.** |
| `packages/pipeline-core/src/queue/types.ts` | 417–419 | `isFollowPromptPayload()` type guard — checks `'promptFilePath' in payload \|\| 'promptContent' in payload`. Unaffected. |
| `packages/coc/src/server/queue-executor-bridge.ts` | 181–224 | `extractPrompt()` — the `isFollowPromptPayload` branch. **Primary edit target.** Currently appends `planFilePath` as a path string and `additionalContext` as `\n\nAdditional context: ...`. |
| `packages/coc/src/server/queue-executor-bridge.ts` | 186–197 | `promptContent` sub-branch — builds prompt from direct content, appends `planFilePath` path string and `additionalContext` flat string. |
| `packages/coc/src/server/queue-executor-bridge.ts` | 199–213 | `promptFilePath` sub-branch — reads prompt file, same append pattern. |
| `packages/coc/src/server/queue-executor-bridge.ts` | 230–242 | `executeByType()` — routes to `executeWithAI()`. No changes needed. |
| `packages/coc/src/server/queue-executor-bridge.ts` | 244–287 | `executeWithAI()` — sends assembled prompt to `sdkService.sendMessage()`. No changes needed. |
| `packages/coc/src/server/queue-executor-bridge.ts` | 289–297 | `getWorkingDirectory()` — extracts working directory from payload. No changes needed. |
| `packages/coc/test/server/queue-executor-bridge.test.ts` | 265–372 | Existing follow-prompt tests — 4 tests covering `promptFilePath`, `promptContent`, `planFilePath`, `additionalContext`. Mock setup at lines 31–43. |
| `packages/coc/test/server/queue-executor-bridge.test.ts` | 347–371 | **Test `should append planFilePath and additionalContext to promptContent`** — asserts current flat format `'Refactor the auth module. /workspace/plan.md\n\nAdditional context: Focus on tests.'`. **This test must be updated** to match the new structured format. |

## Implementation Steps

### 1. Add `resolveContextBlock()` private helper method

**File:** `packages/coc/src/server/queue-executor-bridge.ts`
**Location:** After `getWorkingDirectory()` (after line 297), before `persistOutput()`.

```ts
/**
 * Build a structured context block from additionalContext and planFilePath.
 * Returns the block string, or undefined if no context is available.
 * - Reads planFilePath content from disk if the file exists.
 * - Combines plan content and additionalContext into a single block.
 * - Silently returns undefined on file read errors (non-fatal).
 */
private resolveContextBlock(payload: {
    additionalContext?: string;
    planFilePath?: string;
}): string | undefined {
    const parts: string[] = [];

    // Read plan file content if path is provided and file exists
    if (payload.planFilePath) {
        try {
            if (fs.existsSync(payload.planFilePath)) {
                const planContent = fs.readFileSync(payload.planFilePath, 'utf-8');
                if (planContent.trim()) {
                    parts.push(planContent);
                }
            }
        } catch {
            // Non-fatal: skip plan file
        }
    }

    // Append additional context if provided
    if (payload.additionalContext) {
        parts.push(payload.additionalContext);
    }

    if (parts.length === 0) {
        return undefined;
    }

    return parts.join('\n\n');
}
```

**Design notes:**
- Same error-handling pattern as the existing `promptFilePath` logic in `extractPrompt()`: `try/catch` with silent fallthrough.
- Uses synchronous `fs.readFileSync` — consistent with the existing `fs.existsSync` call in `extractPrompt()`.
- Combines both plan content and additionalContext into one block, separated by double newline.

### 2. Update `extractPrompt()` isFollowPromptPayload branch

**File:** `packages/coc/src/server/queue-executor-bridge.ts`
**Location:** Lines 186–213 — the `isFollowPromptPayload(task.payload)` block.

Replace the entire block (lines 186–213) with:

```ts
if (isFollowPromptPayload(task.payload)) {
    // Resolve structured context block from additionalContext + planFilePath content
    const contextBlock = this.resolveContextBlock(task.payload);

    // Prefer direct prompt content when available (no file I/O needed)
    let prompt: string;
    if (task.payload.promptContent) {
        prompt = task.payload.promptContent;
    } else {
        // Fall back to file-based prompt for backward compatibility / skill jobs
        try {
            if (task.payload.promptFilePath && fs.existsSync(task.payload.promptFilePath)) {
                prompt = `Follow the instruction ${task.payload.promptFilePath}.`;
            } else {
                prompt = `Follow prompt: ${task.payload.promptFilePath || 'unknown'}`;
            }
        } catch {
            prompt = `Follow prompt: ${task.payload.promptFilePath || 'unknown'}`;
        }
    }

    // Prepend context block if available
    if (contextBlock) {
        return `Context document:\n\n${contextBlock}\n\n---\n\n${prompt}`;
    }

    return prompt;
}
```

**Key differences from the old code:**
- `planFilePath` is **no longer appended as a raw path string** to the prompt. Instead, its file content is read in `resolveContextBlock()` and included in the structured context block.
- `additionalContext` is **no longer appended inline** with `\n\nAdditional context: ...`. It is included in the context block, prepended before the prompt.
- When context exists, the format is: `Context document:\n\n{contextBlock}\n\n---\n\n{prompt}`
- When no context fields are provided, prompt is **exactly** the same as before (just `promptContent` or `Follow the instruction ...` — no wrapping, no extra newlines).

### 3. Prompt Construction Format

**With `additionalContext` only:**
```
Context document:

Focus on tests.

---

Refactor the auth module.
```

**With `planFilePath` only (file exists and has content):**
```
Context document:

<contents of plan file>

---

Refactor the auth module.
```

**With both `planFilePath` (readable) and `additionalContext`:**
```
Context document:

<contents of plan file>

Focus on tests.

---

Refactor the auth module.
```

**With `planFilePath` (file missing) + `additionalContext`:**
```
Context document:

Focus on tests.

---

Refactor the auth module.
```

**With neither field:**
```
Refactor the auth module.
```
(Identical to current behavior — zero behavioral change.)

## Tests

**File:** `packages/coc/test/server/queue-executor-bridge.test.ts`

### Existing test update (REQUIRED)

The test at line 347 (`should append planFilePath and additionalContext to promptContent`) currently asserts the old flat format. It must be updated to match the new structured format.

**Current assertion (line 369):**
```ts
expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
    prompt: 'Refactor the auth module. /workspace/plan.md\n\nAdditional context: Focus on tests.',
}));
```

**Updated assertion:** Since `/workspace/plan.md` won't exist in the test environment, `resolveContextBlock()` will skip the plan file and only include `additionalContext`:
```ts
expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
    prompt: 'Context document:\n\nFocus on tests.\n\n---\n\nRefactor the auth module.',
}));
```

### New tests — add `describe('follow-prompt context support', ...)` block

Add inside the existing `describe('follow-prompt tasks', ...)` section, after the existing 4 tests (after line 372).

**Test 1: `additionalContext is prepended as structured context block`**
```ts
it('should prepend additionalContext as structured context block', async () => {
    const executor = new CLITaskExecutor(store);

    const task: QueuedTask = {
        id: 'task-ctx-1',
        type: 'follow-prompt',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            promptContent: 'Implement the feature described above.',
            additionalContext: '# Task: Add login page\n\nCreate a login page with email and password fields.',
        },
        config: {},
    };

    const result = await executor.execute(task);

    expect(result.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Context document:\n\n# Task: Add login page\n\nCreate a login page with email and password fields.\n\n---\n\nImplement the feature described above.',
    }));
});
```

**Test 2: `planFilePath content is read and included in context block`**
```ts
it('should read planFilePath content and include in context block', async () => {
    const existsSyncSpy = vi.spyOn(fs, 'existsSync');
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync');

    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
        if (String(p) === '/workspace/plan.md') return true;
        return false;
    });
    readFileSyncSpy.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
        if (String(p) === '/workspace/plan.md') return '# Plan\n\nStep 1: Do X\nStep 2: Do Y';
        throw new Error('not found');
    });

    const executor = new CLITaskExecutor(store);

    const task: QueuedTask = {
        id: 'task-ctx-2',
        type: 'follow-prompt',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            promptContent: 'Execute this plan.',
            planFilePath: '/workspace/plan.md',
        },
        config: {},
    };

    const result = await executor.execute(task);

    expect(result.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Context document:\n\n# Plan\n\nStep 1: Do X\nStep 2: Do Y\n\n---\n\nExecute this plan.',
    }));

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
});
```

**Test 3: `planFilePath content + additionalContext are combined in context block`**
```ts
it('should combine planFilePath content and additionalContext in context block', async () => {
    const existsSyncSpy = vi.spyOn(fs, 'existsSync');
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync');

    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
        if (String(p) === '/workspace/plan.md') return true;
        return false;
    });
    readFileSyncSpy.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
        if (String(p) === '/workspace/plan.md') return '# Plan\n\nDo things.';
        throw new Error('not found');
    });

    const executor = new CLITaskExecutor(store);

    const task: QueuedTask = {
        id: 'task-ctx-3',
        type: 'follow-prompt',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            promptContent: 'Execute plan with focus.',
            planFilePath: '/workspace/plan.md',
            additionalContext: 'Focus on error handling.',
        },
        config: {},
    };

    const result = await executor.execute(task);

    expect(result.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Context document:\n\n# Plan\n\nDo things.\n\nFocus on error handling.\n\n---\n\nExecute plan with focus.',
    }));

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
});
```

**Test 4: `no context fields — prompt unchanged (backward compatible)`**
```ts
it('should not alter prompt when no context fields are provided', async () => {
    const executor = new CLITaskExecutor(store);

    const task: QueuedTask = {
        id: 'task-ctx-4',
        type: 'follow-prompt',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            promptContent: 'Analyze codebase for vulnerabilities.',
        },
        config: {},
    };

    const result = await executor.execute(task);

    expect(result.success).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Analyze codebase for vulnerabilities.',
    }));
});
```

**Test 5: `planFilePath gracefully handles missing file`**
```ts
it('should ignore planFilePath when file does not exist', async () => {
    const executor = new CLITaskExecutor(store);

    const task: QueuedTask = {
        id: 'task-ctx-5',
        type: 'follow-prompt',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            promptContent: 'Do something.',
            planFilePath: '/nonexistent/plan.md',
        },
        config: {},
    };

    const result = await executor.execute(task);

    expect(result.success).toBe(true);
    // No "Context document:" prefix since plan file doesn't exist and no additionalContext
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Do something.',
    }));
});
```

**Test 6: `additionalContext works with file-based promptFilePath fallback`**
```ts
it('should prepend context when using promptFilePath fallback', async () => {
    const executor = new CLITaskExecutor(store);

    const task: QueuedTask = {
        id: 'task-ctx-6',
        type: 'follow-prompt',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            promptFilePath: '/nonexistent/prompt.md',
            additionalContext: 'Task context here.',
        },
        config: {},
    };

    const result = await executor.execute(task);

    expect(result.success).toBe(true);
    // promptFilePath doesn't exist so falls through to "Follow prompt: ..." message
    // Context is still prepended
    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'Context document:\n\nTask context here.\n\n---\n\nFollow prompt: /nonexistent/prompt.md',
    }));
});
```

## Acceptance Criteria

- [ ] **No changes** to `packages/pipeline-core/src/queue/types.ts` — `FollowPromptPayload` already has `additionalContext` and `planFilePath`
- [ ] When `additionalContext` is provided, it is prepended as `Context document:\n\n{content}\n\n---\n\n{prompt}`
- [ ] When `planFilePath` points to a readable file, its **content** is read and included in the context block (not the raw path string)
- [ ] When both `planFilePath` (readable) and `additionalContext` are provided, plan content comes first, then additionalContext, then separator, then prompt
- [ ] When neither `additionalContext` nor `planFilePath` is provided, prompt is constructed exactly as before (no extra text, no extra newlines)
- [ ] When `planFilePath` points to a nonexistent file, behavior silently falls back (no error thrown, just skipped)
- [ ] `isFollowPromptPayload()` type guard unaffected (checks `promptFilePath` or `promptContent`, not the context fields)
- [ ] POST `/api/queue` requires no changes — payload passes through as-is
- [ ] Existing test `should append planFilePath and additionalContext to promptContent` updated to match new format
- [ ] All 6 new tests pass (`npm run test:run` in `packages/coc/`)
- [ ] All existing queue-executor-bridge tests remain green

## Files Modified

| File | Change |
|---|---|
| `packages/coc/src/server/queue-executor-bridge.ts` | Add `resolveContextBlock()` private method (after `getWorkingDirectory`, ~line 297). Replace `isFollowPromptPayload` branch in `extractPrompt()` (lines 186–213) to use `resolveContextBlock()` and prepend structured context. Remove inline `planFilePath`/`additionalContext` appending. |
| `packages/coc/test/server/queue-executor-bridge.test.ts` | Update existing test at line 347 to match new prompt format. Add 6 new tests in `describe('follow-prompt context support', ...)` block after line 372. |

## Dependencies

- Depends on: None (modifies existing executor; `additionalContext` field already exists in pipeline-core types)
