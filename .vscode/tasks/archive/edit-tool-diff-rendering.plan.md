---
status: done
---

# Better Edit Tool Rendering in CoC Chat

## Problem

The `edit` tool call in the CoC SPA chat interface renders its arguments as raw JSON — `old_str` and `new_str` appear as escaped strings with literal `\n` characters, making it nearly impossible to read the actual code change. The user sees a wall of JSON instead of a clear before/after view.

![Current state: raw JSON blob with escaped newlines](image-reference)

## Goal

Render `edit` tool calls as a **unified diff view** with proper line breaks, syntax highlighting, and red/green addition/deletion markers — similar to how GitHub or VS Code renders diffs.

## Approach

Replace the generic JSON rendering for `edit` (and `create`) tool calls with purpose-built rendering:

1. **Edit tool** → unified diff view: `old_str` shown with red (deletion) lines, `new_str` shown with green (addition) lines, file path as a header
2. **Create tool** → syntax-highlighted code block for `file_text`, with file path as header
3. Apply to **both** renderers: `ToolCallView.tsx` (React, primary) and `tool-renderer.ts` (legacy vanilla-JS)

### Diff Computation

Use a lightweight inline diff approach:
- Split `old_str` and `new_str` by newlines
- Compute a simple line-level diff (the `diff` package at `^5.2.0` already exists in root `package.json` — add it to the coc package or implement a minimal line diff)
- Render as unified diff with `+`/`-` line prefixes and color coding

### No New Dependencies (preferred)

The line-by-line diff can be computed with a simple algorithm since `old_str`→`new_str` are typically small (<100 lines). If we want higher quality diffs, we can add `diff` (already in the monorepo root) to the coc package's dependencies.

## Changes

### 1. `ToolCallView.tsx` — React renderer (primary)

**File:** `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx`

- Add an `EditToolView` sub-component that:
  - Extracts `path`, `old_str`, `new_str` from args
  - Shows file path as a header row (already in summary, but also in expanded body)
  - Computes line-level diff between `old_str` and `new_str`
  - Renders diff lines with:
    - Red background + `−` prefix for removed lines (`old_str` only)
    - Green background + `+` prefix for added lines (`new_str` only)
    - No prefix for context/unchanged lines
  - Uses monospace font, proper line wrapping
- Add a `CreateToolView` sub-component that:
  - Extracts `path`, `file_text` from args
  - Renders `file_text` as a syntax-highlighted code block (detect language from file extension)
- In the main body rendering (`name !== 'bash'` block), add branches for `edit` and `create` tools

### 2. `tool-renderer.ts` — Legacy vanilla-JS renderer

**File:** `packages/coc/src/server/spa/client/tool-renderer.ts`

- Add `buildEditArgsHTML(args)` function that produces the same diff view as HTML strings
- Add `buildCreateArgsHTML(args)` function for create tool
- Update `buildArgsHTML()` to route `edit` and `create` through the new functions

### 3. Tailwind CSS / Styles

**File:** `packages/coc/src/server/spa/client/tailwind.css` (or inline styles in components)

- Add diff-specific styles:
  - `.diff-line-added` — green background (`bg-green-900/20` dark, `bg-green-50` light)
  - `.diff-line-removed` — red background (`bg-red-900/20` dark, `bg-red-50` light)
  - `.diff-line-context` — neutral background
  - `.diff-header` — file path styling
  - Proper monospace font, line numbers (optional)

### 4. Diff utility (if needed)

**File:** `packages/coc/src/server/spa/client/react/processes/diff-utils.ts` (new)

- Simple line-level diff function: `computeLineDiff(oldStr: string, newStr: string): DiffLine[]`
- Each `DiffLine` has `type: 'added' | 'removed' | 'context'` and `content: string`
- Algorithm: simple LCS-based or Myers diff (or import `diff` library's `diffLines`)

## Rendering Design

```
┌─────────────────────────────────────────────────┐
│ ✅ edit  GenerateTaskDialog.tsx          250ms ▶ │
├─────────────────────────────────────────────────┤
│ 📁 packages/.../react/tasks/GenerateTaskDialog.tsx │
│ ┌─────────────────────────────────────────────┐ │
│ │   useEffect(() => {                         │ │
│ │     if (status === 'queued') {              │ │
│ │-      onSuccess(taskId || '');              │ │
│ │+      clearImages();                        │ │
│ │+      onSuccess(taskId || '');              │ │
│ │       addToast(`Task queued...`, 'success');│ │
│ │     }                                       │ │
│ │   }, [status, taskId, ...]);                │ │
│ └─────────────────────────────────────────────┘ │
│ RESULT                                          │
│ File ... updated with changes.                  │
└─────────────────────────────────────────────────┘
```

## Out of Scope

- Syntax highlighting within diff lines (would need language detection + tokenizer — future enhancement)
- Side-by-side diff view (unified is sufficient for the narrow chat panel)
- `view` tool rendering improvements (separate task)
- Line numbers in the original file (not available in the tool args)

## Testing

- Unit test for `computeLineDiff()` with various cases (addition only, deletion only, modification, multi-line, empty strings)
- Visual test: verify rendering in the SPA with a real `edit` tool call
- Edge cases: `old_str` is empty (full replacement), `new_str` is empty (deletion), very long strings (truncation), binary-looking content

## Risks

- **Bundle size**: Adding `diff` library adds ~15KB. Alternatively, a minimal inline diff (~50 lines) keeps it zero-dependency.
- **Performance**: Large `old_str`/`new_str` (5000+ chars) may be slow with naive diff. Add a size threshold — fall back to raw display above N lines.
- **Legacy renderer**: The `tool-renderer.ts` is vanilla JS with HTML strings, so the diff rendering needs to be duplicated in that format. Consider extracting shared diff logic.
