# Add Ctrl+Enter to Submit Generate Task Dialog

## Problem

The "Generate Task" dialog (`GenerateTaskDialog.tsx`) requires clicking the **Generate** button to submit. Users expect **Ctrl+Enter** (or **Cmd+Enter** on macOS) to submit from the prompt textarea — a standard keyboard shortcut for multi-line form submission.

## Current State

| Item | Location | Status |
|------|----------|--------|
| GenerateTaskDialog component | `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` | No keyboard shortcut |
| Prompt textarea (line 176) | Same file | Has `onChange` and `onPaste` only |
| `handleGenerate` callback (line 116) | Same file | Already extracted, ready to wire |
| Existing Ctrl+Enter pattern | `tasks/comments/InlineCommentPopup.tsx:70` | `(e.ctrlKey \|\| e.metaKey) && e.key === 'Enter'` |

## Approach

Add an `onKeyDown` handler to the prompt `<textarea>` that calls `handleGenerate` on Ctrl+Enter / Cmd+Enter, matching the existing pattern from `InlineCommentPopup`. Also add a keyboard hint on the Generate button for discoverability.

Single-file change, ~10 lines added.

## Todos

### 1. Add `onKeyDown` handler to textarea
- **File**: `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx`
- On the `<textarea>` element (line 176), add `onKeyDown` that checks:
  - `(e.ctrlKey || e.metaKey) && e.key === 'Enter'`
  - Guard: `prompt.trim()` is non-empty and not `isSubmitting` / `isQueued`
  - Calls `e.preventDefault()` then `handleGenerate()`
- Pattern matches `InlineCommentPopup.tsx:70` for consistency

### 2. Add keyboard hint to Generate button
- **File**: Same file
- Inside the Generate `<Button>` (line 148), append a `<kbd>` hint: `Ctrl+Enter`
- Style: `className="ml-1 text-[9px] opacity-60"` (matches `InlineCommentPopup.tsx:146`)

### 3. Test
- Build: `npm run build`
- Run tests: `cd packages/coc && npm run test:run`
