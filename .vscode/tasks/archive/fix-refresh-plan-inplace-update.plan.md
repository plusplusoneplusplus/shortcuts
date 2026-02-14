---
status: done
---

# Fix: AI Not In-Place Updating Plan Files

## Problem Statement

When using the "Refresh Plan" AI action in the Markdown Review Editor, the AI creates a **new file** in its session state directory (`~/.copilot/session-state/...`) instead of **editing the original file in-place** at the specified path.

### Root Cause

The current prompt uses weak directive language:
```
Please update the plan file at: ${filePath}
```

This is interpreted by the AI as an instruction to create updated content, not as a directive to use the `edit` tool on the specific file. The AI's default behavior is to create files in its session workspace, not modify arbitrary files unless explicitly directed.

### Evidence from User Report

```
● Create ~/.copilot/session-state/19ff2d43-ca2e-403e-ab54-80cb9e30d9a9/plan.md (+203)
```

AI created a new `plan.md` in its session state instead of updating `/Users/yihengtao/Documents/Projects/shortcuts/.vscode/tasks/MarkdownReviewEditor/ai-action-resolve-comments-background.plan.md`.

---

## Proposed Solution

Strengthen the prompt to **explicitly require using the `edit` tool** on the exact file path, and **prohibit creating new files**.

### Key Changes

1. **Add explicit tool usage directive**: Tell AI to use `edit` or `view` + `edit` flow
2. **Add prohibition against new file creation**: Explicitly forbid `create` tool usage
3. **Use the same pattern as successful task creation prompts**: Match the "IMPORTANT: Output Location Requirement" pattern

---

## Work Plan

### File to Modify
`src/shortcuts/markdown-comments/review-editor-view-provider.ts` - `handleRefreshPlan` method (lines 1982-2050)

### Tasks

- [x] **Task 1: Update prompt in `handleRefreshPlan`**
  - Location: `review-editor-view-provider.ts` lines 2104-2120
  - Updated prompt to use agent-agnostic language (no specific tool names)
  - New prompt includes:
    - CRITICAL: In-Place Update Required
    - Target file path clearly specified
    - Instructions to read file first, then edit in-place
    - PROHIBITED section (no new files, no session state, no stdout output)
    - Clear statement that ONLY acceptable action is modifying existing file

- [x] **Task 2: Update corresponding test expectations**
  - File: `src/test/suite/refresh-plan-dialog.test.ts`
  - Updated `buildRefreshPlanPrompt` helper function to match new prompt format
  - Added new test suite "Refresh Plan Dialog - In-Place Edit Directive" with 6 tests:
    - Prompt should include explicit in-place edit requirement
    - Prompt should prohibit creating new files
    - Prompt should prohibit writing to session state
    - Prompt should specify target file path clearly
    - Prompt should include instruction to read file first
    - Prompt should state only acceptable action is modifying existing file

- [ ] **Task 3: Manual verification**
  - Open a `.plan.md` file in the Markdown Review Editor
  - Use AI Action → Refresh Plan
  - Verify the AI edits the original file, not creates a new one in session state

---

## Similar Pattern Reference

The task creation prompts in `ai-task-commands.ts` (lines 890-895) use this effective pattern:

```typescript
**IMPORTANT: Output Location Requirement**
You MUST save the file to this EXACT directory: ${targetPath}
- Do NOT save to any other location
- Do NOT use your session state or any other directory
```

The refresh plan prompt should follow a similar explicit directive pattern but for **editing** rather than creating.

---

## Success Criteria

1. When "Refresh Plan" is invoked, AI must:
   - Use `view` to read the existing file content
   - Use `edit` to modify sections in-place
   - NOT create any new files
   - NOT write to session state directory

2. All existing tests must pass after changes

3. New test verifies the explicit edit tool directive is present in the prompt
