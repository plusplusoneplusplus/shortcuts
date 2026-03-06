---
status: done
---

# 001: Fix Anchor Creation with Source-Accurate Positions

## Summary

Replace the `offsetToPosition`-based line/column calculation in `MarkdownReviewEditor`'s mouseup handler with a DOM-aware approach that reads `data-line` attributes from the rendered `<div class="md-line">` elements, so anchor positions correspond to raw markdown source lines rather than rendered preview textContent.

## Motivation

This is the foundational fix — every downstream anchor feature (relocation, highlighting, persistence) depends on correct `startLine`/`endLine`/`startColumn`/`endColumn` values. Without this, `createAnchorData` receives rendered-text positions, producing wrong `contextBefore`/`contextAfter`/`selectedText` and broken relocation on content changes.

## Changes

### Files to Modify

- `packages/coc/src/server/spa/client/react/shared/MarkdownReviewEditor.tsx` — Replace the position computation inside the `handleMouseUp` closure (lines 237–267) to derive `startLine`/`endLine` from the nearest ancestor `div.md-line[data-line]` of the selection's start and end nodes, and compute `startColumn`/`endColumn` as offsets within the corresponding raw markdown source lines. Remove or deprecate the `offsetToPosition` helper (line 632–636) if no other callers remain; otherwise mark it with a `@deprecated` JSDoc tag.

### Helper to Add (same file, or a new utility)

- Add a function `selectionToSourcePosition(rawContent: string, previewRoot: HTMLElement, range: Range): { startLine, startColumn, endLine, endColumn }` that:
  1. Walks from `range.startContainer` / `range.endContainer` up to the closest `div.md-line[data-line]` ancestor.
  2. Reads the `data-line` attribute (1-based source line number).
  3. Uses `getTextOffset(mdLineDiv, range.startContainer, range.startOffset)` scoped to that single `md-line` div (not the entire preview root) to get the character offset within the rendered line.
  4. Uses the raw markdown source line (`rawContent.split('\n')[dataLine - 1]`) to validate the column offset — if the rendered text is shorter than the raw line (e.g., stripped markdown syntax), clamp to the line length + 1.
  5. Returns 1-based `{ startLine, startColumn, endLine, endColumn }`.

## Implementation Notes

### Current flow (broken)

```
mouseup → getTextOffset(previewRef.current, ...) → offsetToPosition(previewText, offset)
```

- `getTextOffset` (line 622) walks **all** text nodes under `previewRef.current` to compute a flat character offset into the preview's concatenated textContent.
- `offsetToPosition` (line 632) splits that textContent by `\n` and counts lines — these are **rendered** lines, not raw markdown lines (e.g., a `# Heading` renders as `Heading` with no `#`).

### New flow (correct)

```
mouseup → find ancestor div.md-line[data-line] → read data-line → compute column within that line div
```

- The markdown renderer (`markdown-renderer.ts`, line 150) wraps every source line in `<div class="md-line" data-line="{lineNum}">` where `lineNum` is the 1-based source line index.
- For multi-line selections, the start and end containers may live in different `md-line` divs — walk up from each independently.
- Block-level elements (code blocks, tables) rendered by `renderBlockToHtml` are **not** wrapped in `md-line` divs — those are skipped by the line loop (line 140: `isInsideBlock` check). For selections that start or end inside a block, fall back to scanning `data-line` attributes on preceding siblings and interpolating. This edge case should be documented with a TODO for a follow-up commit.

### Column offset subtlety

The rendered text inside a `md-line` div strips markdown syntax (e.g., `**bold**` becomes `bold`). The column offset from `getTextOffset` scoped to the `md-line` div corresponds to the rendered text, not the raw source. Two options:

1. **Substring search** (recommended): Find the selected text within the raw source line and use its index as `startColumn`. For single-line selections, `rawLine.indexOf(selectedText)` suffices. For multi-line, only the first and last lines need column mapping.
2. **Offset mapping table**: Build a char-by-char map from rendered to source — overkill for this commit.

### `createAnchorData` contract

`createAnchorData` (anchor.ts, line 72) takes 1-based `startLine`, `endLine`, `startColumn`, `endColumn` and indexes into `content` (the raw markdown). It calls `getCharOffset` to convert to a flat offset, then `extractContext` for surrounding text. If we pass correct source positions, `contextBefore`/`contextAfter` will naturally be correct.

### Scope of `getTextOffset` reuse

`getTextOffset` (line 622) is still useful but must be called with a **scoped container** (the `md-line` div, not the entire preview root) to get the within-line character offset.

## Tests

- Unit test: `selectionToSourcePosition` returns correct 1-based positions for a single-line selection inside a `md-line` div (mock DOM with `data-line` attributes).
- Unit test: multi-line selection spanning two `md-line` divs returns the correct start and end line numbers from `data-line`.
- Unit test: column offset uses raw source line content (e.g., `**bold**` selection at rendered column 1 maps to source column 3).
- Unit test: selection inside a block element (no `md-line` ancestor) falls back gracefully without throwing.
- Integration test: `handlePopupSubmit` passes source-accurate positions to `createAnchorData` — verify `anchor.contextBefore`/`contextAfter` match raw markdown surrounding text (not rendered text).

## Acceptance Criteria

- [ ] Selecting text in the rendered preview and adding a comment produces an anchor whose `startLine`/`endLine` match the raw markdown source line numbers (verified by inspecting the comment payload sent to the API).
- [ ] `contextBefore` and `contextAfter` in the persisted anchor contain raw markdown text, not stripped rendered text.
- [ ] Single-line and multi-line selections both produce correct positions.
- [ ] Selections inside block-level elements (code blocks) do not crash; they either produce correct positions or degrade gracefully with a console warning.
- [ ] The existing `getTextOffset` helper is still used (scoped to `md-line` divs) — no unnecessary code deletion.
- [ ] All new and existing tests pass.

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit.
