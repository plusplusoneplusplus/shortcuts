# Plan: Rename "✨ Generate with AI" to "✨ Generate task with AI"

## Problem
The button label `✨ Generate with AI` in the Tasks panel toolbar needs to be renamed to `✨ Generate task with AI` for clarity.

## Affected Files

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/TaskActions.tsx` | Update button label (line 59) |
| `packages/coc/test/spa/react/TaskActions.test.tsx` | Update test description and assertion strings |

## Changes

### 1. `TaskActions.tsx` (line 59)
```diff
- ✨ Generate with AI
+ ✨ Generate task with AI
```

### 2. `TaskActions.test.tsx`
- Update `describe` block title: `'TaskActions — Generate with AI button'` → `'TaskActions — Generate task with AI button'`
- Update file header comment accordingly
- Update `expect(btn.textContent).toContain('Generate with AI')` → `toContain('Generate task with AI')`

## Notes
- No logic changes — purely a label/string rename.
- No other files reference this string.
