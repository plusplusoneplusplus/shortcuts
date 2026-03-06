---
status: pending
---

# 006: Hunk-based inline view rendering

## Summary

Rewrite `renderInlineDiff()` to use the same two-phase hunk-based approach proven in commit 005's split view: first populate `alignedDiffInfo[]` and `lineToIndexMap` for ALL aligned lines, then iterate `groupIntoHunks()` output to render hunk headers, collapsed sections, and diff lines into the single `#inline-content` container.

## Motivation

Commit 005 solved the "diff not showing" problem for the split view by switching from flat line iteration to hunk-based rendering. The inline view still uses the old flat iteration pattern (lines 608-709), meaning large diffs with many unchanged context lines still bury the actual changes. This commit applies the identical architectural pattern to the inline view, fully resolving the rendering problem for both view modes and keeping the two renderers structurally consistent.

## Changes

### Files to Create

- (none)

### Files to Modify

- `src/shortcuts/git-diff-comments/webview-scripts/diff-renderer.ts` — Rewrite `renderInlineDiff()` (lines 580-713) to use the two-phase hunk-based rendering pattern.

### Files to Delete

- (none)

## Implementation Notes

### Structural difference from split view

The inline view is simpler than the split view:
- **Single container** (`#inline-content`) instead of two (`#old-content`, `#new-content`). Hunk headers and collapsed sections are just appended in sequence — no need to synchronize insertions across two panes.
- **`createInlineLineElement()`** instead of `createLineElement()` + `createEmptyLineElement()`. Each line carries both old and new line numbers in one gutter row.
- **No scroll sync** — there is only one scrollable container.

### Hunk headers in inline view

In split view, `createHunkHeaderElement()` is appended to both panes. In inline view, a single hunk header element spans the full width of `#inline-content`. The helper from commit 004 already creates a standalone `<div>` — it simply gets appended once instead of twice. If the helper accepts a `variant` or `colspan` hint, pass `'inline'`; otherwise the default full-width block behaviour is correct as-is since `#inline-content` is a single-column flow layout.

### Collapsed sections in inline view

`createCollapsedSectionElement()` is likewise appended once to `#inline-content`. It must carry `data-hunk-index` for expand/collapse logic (same as split view). Because there is no pane synchronization, the expand handler only needs to insert lines into `#inline-content` at the correct position — simpler than the split case.

### Two-phase approach (pseudocode)

```typescript
export function renderInlineDiff(): void {
    const state = getState();
    const ignoreWhitespace = getIgnoreWhitespace();
    const inlineContainer = document.getElementById('inline-content');
    if (!inlineContainer) { console.error('Inline diff container not found'); return; }

    inlineContainer.innerHTML = '';
    alignedDiffInfo = [];
    lineToIndexMap = new Map();

    const oldLines = parseLines(state.oldContent);
    const newLines = parseLines(state.newContent);
    const { oldHighlighted, newHighlighted } = getHighlightedLines();

    const dp = computeLCS(oldLines, newLines, ignoreWhitespace);
    const aligned = backtrackLCS(oldLines, newLines, dp, ignoreWhitespace);

    // ── Phase 1: Populate alignedDiffInfo and lineToIndexMap for ALL lines ──
    for (const [i, line] of aligned.entries()) {
        const comments = line.type === 'deletion'
            ? getCommentsForLine('old', line.oldLineNum!)
            : line.type === 'addition'
              ? getCommentsForLine('new', line.newLineNum!)
              : getCommentsForLine('new', line.newLineNum!);  // context: check new side

        alignedDiffInfo.push({
            index: i,
            type: line.type === 'context' ? 'context'
                : line.type === 'addition' ? 'addition'
                : 'deletion',
            hasComment: comments.length > 0,
            oldLineNum: line.oldLineNum,
            newLineNum: line.newLineNum
        });

        if (line.oldLineNum !== null) {
            lineToIndexMap.set(`old:${line.oldLineNum}`, i);
        }
        if (line.newLineNum !== null) {
            lineToIndexMap.set(`new:${line.newLineNum}`, i);
        }
    }

    // ── Phase 2: Render hunks ──
    const hunks = groupIntoHunks(aligned, 3);  // 3 lines context
    let globalLineIndex = 0;  // tracks position in `aligned` for collapsed count

    for (const [hunkIdx, hunk] of hunks.entries()) {
        // Insert collapsed section for lines preceding this hunk
        const precedingCollapsed = hunk.precedingCollapsedCount ?? 0;
        if (precedingCollapsed > 0) {
            const collapsedEl = createCollapsedSectionElement(
                precedingCollapsed,
                hunkIdx
            );
            inlineContainer.appendChild(collapsedEl);
        }

        // Insert hunk header (single element, full width of inline container)
        const hunkHeaderEl = createHunkHeaderElement(hunk);
        inlineContainer.appendChild(hunkHeaderEl);

        // Render each line in the hunk
        for (const line of hunk.lines) {
            let highlightedContent: string | undefined;
            let comments: DiffComment[] = [];
            let type: DiffLineType;
            let side: 'old' | 'new' | 'context';
            let content: string;
            let oldNum: number | null;
            let newNum: number | null;

            if (line.type === 'context') {
                type = 'context';
                side = 'context';
                content = line.newLine || line.oldLine || '';
                oldNum = line.oldLineNum;
                newNum = line.newLineNum;
                comments = getCommentsForLine('new', line.newLineNum!);
                highlightedContent = newHighlighted[line.newLineNum! - 1];
            } else if (line.type === 'deletion') {
                type = 'deletion';
                side = 'old';
                content = line.oldLine || '';
                oldNum = line.oldLineNum;
                newNum = null;
                comments = getCommentsForLine('old', line.oldLineNum!);
                highlightedContent = oldHighlighted[line.oldLineNum! - 1];
            } else {
                // addition
                type = 'addition';
                side = 'new';
                content = line.newLine || '';
                oldNum = null;
                newNum = line.newLineNum;
                comments = getCommentsForLine('new', line.newLineNum!);
                highlightedContent = newHighlighted[line.newLineNum! - 1];
            }

            const lineEl = createInlineLineElement(
                oldNum, newNum, content, type, side,
                comments, highlightedContent
            );
            inlineContainer.appendChild(lineEl);
        }
    }

    // Handle trailing collapsed section (lines after the last hunk)
    // groupIntoHunks may report this via the last hunk's trailingCollapsedCount
    // or we may need to compute it from aligned.length - last hunk boundary.
    // Check groupIntoHunks contract from commit 003 and handle accordingly.

    renderIndicatorBar();
}
```

### Key decisions

1. **Phase 1 iterates `aligned` directly** — identical to commit 005. This guarantees `alignedDiffInfo` indices are stable regardless of hunk grouping, so the indicator bar and navigation (`lineToIndexMap`) work unchanged.

2. **Phase 2 iterates `hunks`** — the rendering loop switches from `for (const line of aligned)` to `for (const hunk of hunks)`. Each hunk gets a header, and collapsed sections separate hunks.

3. **Comment lookup per line is duplicated** between Phase 1 and Phase 2. Phase 1 only needs `hasComment` (boolean), Phase 2 needs the full `DiffComment[]` array for `createInlineLineElement()`. This is intentional — it keeps the phases decoupled and mirrors the split view implementation.

4. **`createInlineLineElement()` is unchanged** — no modifications needed to the element factory. All hunk/collapsed logic is purely at the container level.

5. **No scroll sync changes** — inline view has a single container, so there is nothing to synchronize. The scroll-sync setup call is already absent from `renderInlineDiff()`.

### Edge cases

- **Empty diff (no changes):** `groupIntoHunks()` returns zero hunks. Only context lines exist; the entire file becomes one collapsed section with no hunk headers. The indicator bar renders with no marks.
- **All lines changed:** Every line is addition/deletion, zero context. `groupIntoHunks()` returns one hunk covering all lines, no collapsed sections.
- **Single-line file:** One hunk, one line, no collapsed sections.
- **Comments on collapsed lines:** `alignedDiffInfo` is populated for ALL lines (Phase 1), so the indicator bar still shows comment marks for lines hidden inside collapsed sections. Navigation via `lineToIndexMap` still resolves. When user clicks a comment indicator, the expand-collapse handler (future commit) will need to reveal the collapsed section.

## Tests

- **Build verification:** `npm run compile` succeeds with no TypeScript errors.
- **Manual test — basic rendering:** Open a diff with mixed additions/deletions/context → switch to inline view → verify hunk headers appear between change regions with collapsed sections for distant context.
- **Manual test — indicator bar:** Verify the indicator bar still renders coloured marks for additions (green) and deletions (red) in inline view.
- **Manual test — navigation:** Click an indicator bar mark → view scrolls to the correct hunk in inline view.
- **Manual test — comments:** Lines with comments still show the 💬 indicator and highlight background colour.
- **Manual test — empty diff:** Open a diff with no changes → inline view shows a single collapsed section (or all context), no errors in console.
- **Manual test — view mode toggle:** Switch between split and inline views repeatedly → both render correctly using hunk-based layout, no stale DOM or console errors.

## Acceptance Criteria

- [ ] `renderInlineDiff()` uses `groupIntoHunks()` to iterate hunks instead of flat aligned lines
- [ ] `alignedDiffInfo[]` is populated for ALL aligned lines in Phase 1 (before rendering)
- [ ] `lineToIndexMap` is populated for ALL aligned lines in Phase 1
- [ ] Hunk headers appear in `#inline-content` between change regions (full-width, single column)
- [ ] Collapsed section placeholders appear between non-adjacent hunks showing line count
- [ ] Collapsed sections carry `data-hunk-index` attribute for future expand/collapse
- [ ] `createInlineLineElement()` is used unchanged for rendering individual lines
- [ ] Indicator bar renders correctly in inline view (coloured marks for additions/deletions)
- [ ] Navigation via indicator bar marks scrolls to the correct position in inline view
- [ ] Comment indicators (💬) and highlight colours still render on commented lines
- [ ] `npm run compile` succeeds with no errors
- [ ] Switching between split and inline views works without errors or stale DOM

## Dependencies

- Depends on: 003 (`groupIntoHunks()` algorithm), 004 (`createHunkHeaderElement()`, `createCollapsedSectionElement()`, CSS), 005 (proven pattern, structural parity)

## Assumed Prior State

`groupIntoHunks()` exists and returns `Hunk[]` with `precedingCollapsedCount` metadata (003). `createHunkHeaderElement()` and `createCollapsedSectionElement()` exist as reusable DOM helpers with associated CSS (004). `renderSplitDiff()` already uses the two-phase hunk-based rendering pattern and is confirmed working (005). `renderInlineDiff()` still uses the original flat iteration pattern over `aligned` lines (lines 608-709), rendering every line sequentially into `#inline-content` without hunk grouping.
