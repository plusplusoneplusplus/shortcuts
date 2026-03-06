---
status: pending
---

# 005: Hunk-based split view rendering

## Summary

Replace the flat `aligned` line-by-line iteration in `renderSplitDiff()` with hunk-grouped rendering: only lines within context-distance of a change are appended to the DOM, separated by hunk headers (`@@ … @@`) and collapsed-section placeholders. `alignedDiffInfo[]` continues to be populated for **all** aligned lines so the indicator bar and comment mapping work unchanged.

## Motivation

This is the core fix for the "diff not showing" problem. When a 500-line file has a 2-line change, the current flat rendering buries the change in hundreds of context lines—the user sees nothing but unchanged code on initial load. Hunk-based rendering makes changes visible immediately, matching the experience users expect from `git diff` and GitHub's PR view.

## Changes

### Files to Create
- (none)

### Files to Modify
- `src/shortcuts/git-diff-comments/webview-scripts/diff-renderer.ts` — rewrite the rendering loop inside `renderSplitDiff()` (lines 398–463) to iterate hunks instead of flat aligned lines, while preserving all data-structure population.

### Files to Delete
- (none)

## Implementation Notes

### Current flow (lines 368–470)

```
renderSplitDiff()
  ├─ get state, containers, reset alignedDiffInfo / lineToIndexMap
  ├─ parse + highlight old/new lines
  ├─ compute LCS → aligned: AlignedLine[]
  ├─ FOR each line in aligned (lineIndex 0..N-1):        ← FLAT LOOP
  │     push to alignedDiffInfo[lineIndex]
  │     update lineToIndexMap ("old:N" / "new:N" → lineIndex)
  │     append createLineElement() or createEmptyLineElement() to BOTH containers
  ├─ setupScrollSync()
  └─ renderIndicatorBar()
```

### New flow (after this commit)

```
renderSplitDiff()
  ├─ get state, containers, reset alignedDiffInfo / lineToIndexMap
  ├─ parse + highlight old/new lines
  ├─ compute LCS → aligned: AlignedLine[]
  │
  │  ── PHASE 1: populate data structures for ALL aligned lines ──
  ├─ FOR each line in aligned (lineIndex 0..N-1):
  │     push to alignedDiffInfo[lineIndex]
  │     update lineToIndexMap ("old:N" / "new:N" → lineIndex)
  │     (NO DOM appending here)
  │
  │  ── PHASE 2: hunk-based DOM rendering ──
  ├─ const hunks = groupIntoHunks(aligned, 3)
  ├─ FOR each hunk (hunkIdx 0..H-1):
  │     IF hunkIdx === 0 && hunk.precedingCollapsedCount > 0:
  │       append createCollapsedSectionElement(count, -1) to BOTH containers
  │     append createHunkHeaderElement(hunk, 'split') to BOTH containers
  │     FOR each line in hunk.lines:
  │       append line elements to BOTH containers (same logic as today)
  │     IF hunkIdx < hunks.length - 1:
  │       next = hunks[hunkIdx + 1]
  │       append createCollapsedSectionElement(next.precedingCollapsedCount, hunkIdx) to BOTH containers
  │     ELSE IF trailing collapsed lines exist after last hunk:
  │       append createCollapsedSectionElement(trailingCount, hunkIdx) to BOTH containers
  │
  ├─ setupScrollSync()
  └─ renderIndicatorBar()
```

### Pseudocode for the new rendering loop

```typescript
// ── PHASE 1: Populate data structures for ALL aligned lines ──
let lineIndex = 0;
for (const line of aligned) {
    const oldComments = line.oldLineNum ? getCommentsForLine('old', line.oldLineNum) : [];
    const newComments = line.newLineNum ? getCommentsForLine('new', line.newLineNum) : [];
    const hasComment = oldComments.length > 0 || newComments.length > 0;

    alignedDiffInfo.push({
        index: lineIndex,
        type: line.type === 'context' ? 'context' : (line.type === 'addition' ? 'addition' : 'deletion'),
        hasComment,
        oldLineNum: line.oldLineNum,
        newLineNum: line.newLineNum
    });

    if (line.oldLineNum !== null) {
        lineToIndexMap.set(`old:${line.oldLineNum}`, lineIndex);
    }
    if (line.newLineNum !== null) {
        lineToIndexMap.set(`new:${line.newLineNum}`, lineIndex);
    }
    lineIndex++;
}

// ── PHASE 2: Hunk-based DOM rendering ──
const hunks = groupIntoHunks(aligned, 3);

for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
    const hunk = hunks[hunkIdx];

    // Collapsed section BEFORE this hunk (lines not shown between previous hunk and this one)
    if (hunk.precedingCollapsedCount > 0) {
        const collapsedOld = createCollapsedSectionElement(hunk.precedingCollapsedCount, hunkIdx - 1);
        const collapsedNew = createCollapsedSectionElement(hunk.precedingCollapsedCount, hunkIdx - 1);
        oldContainer.appendChild(collapsedOld);
        newContainer.appendChild(collapsedNew);
    }

    // Hunk header (e.g., @@ -10,7 +10,8 @@)
    const headerOld = createHunkHeaderElement(hunk, 'split');
    const headerNew = createHunkHeaderElement(hunk, 'split');
    oldContainer.appendChild(headerOld);
    newContainer.appendChild(headerNew);

    // Render each line in the hunk
    for (const line of hunk.lines) {
        // Old side
        if (line.oldLine !== null && line.oldLineNum !== null) {
            const comments = getCommentsForLine('old', line.oldLineNum);
            const type: DiffLineType = line.type === 'context' ? 'context' : 'deletion';
            const highlightedContent = oldHighlighted[line.oldLineNum - 1];
            const lineEl = createLineElement(line.oldLineNum, line.oldLine, type, 'old', comments, highlightedContent);
            oldContainer.appendChild(lineEl);
        } else {
            oldContainer.appendChild(createEmptyLineElement());
        }

        // New side
        if (line.newLine !== null && line.newLineNum !== null) {
            const comments = getCommentsForLine('new', line.newLineNum);
            const type: DiffLineType = line.type === 'context' ? 'context' : 'addition';
            const highlightedContent = newHighlighted[line.newLineNum - 1];
            const lineEl = createLineElement(line.newLineNum, line.newLine, type, 'new', comments, highlightedContent);
            newContainer.appendChild(lineEl);
        } else {
            newContainer.appendChild(createEmptyLineElement());
        }
    }
}

// Trailing collapsed section after the last hunk
if (hunks.length > 0) {
    const lastHunk = hunks[hunks.length - 1];
    const lastHunkEndIdx = /* compute from lastHunk's last line position in aligned[] */;
    const trailingCount = aligned.length - lastHunkEndIdx - 1;
    if (trailingCount > 0) {
        const collapsedOld = createCollapsedSectionElement(trailingCount, hunks.length - 1);
        const collapsedNew = createCollapsedSectionElement(trailingCount, hunks.length - 1);
        oldContainer.appendChild(collapsedOld);
        newContainer.appendChild(collapsedNew);
    }
}
```

### Key decisions and gotchas

1. **Two-phase loop is essential.** `alignedDiffInfo[]` must contain an entry for every aligned line (including collapsed ones) because `renderIndicatorBar()` iterates the full array and `lineToIndexMap` maps comment line numbers into it. Splitting into Phase 1 (data) and Phase 2 (DOM) is the cleanest way to decouple the two concerns.

2. **Indicator bar index-to-DOM mismatch.** `renderIndicatorBar()` queries `.diff-line` elements by index (`lineElements[startIdx]`) and assumes the Nth `.diff-line` in the DOM is the Nth entry in `alignedDiffInfo`. With hunk rendering, collapsed lines have no DOM element so this 1:1 mapping breaks. Two options:
   - **(A) Fallback-only indicator bar:** Remove the DOM-based `offsetTop` calculation and always use the percentage fallback (`startIdx / totalLines * barHeight`). This is simpler and still accurate since the bar represents the *logical* file, not the *visible* DOM.
   - **(B) Build an index→DOM map.** During Phase 2, track which `alignedDiffInfo` indices got rendered and build a sparse map. `calculateMarkPosition` looks up the map; if the index is in a collapsed section, interpolate.
   
   **Decision: use option (A).** The percentage fallback already exists and is the right semantic — the indicator bar is a minimap of the full file, not the visible DOM. The DOM-based path was an optimization for pixel-accurate positioning that becomes misleading when most lines are hidden. Update `calculateMarkPosition` in `renderIndicatorBar()` to always use the percentage formula when the view is split and hunked.

3. **`scrollToLineIndex()` also uses `lineElements[index]`.** This function scrolls to a line by its aligned index. With collapsed sections, the target line may not be in the DOM. For this commit, if `lineElements[index]` is `undefined`, find the nearest visible `.diff-line` that has a `data-line-number` matching the target and scroll to that. A robust expand-and-scroll is deferred to a future commit.

4. **`scrollToFirstChange()` is unaffected.** It queries `.line-added` / `.line-deleted` by CSS class, not by index. Since hunk rendering always includes changed lines in the DOM, it still works.

5. **Hunk headers must be appended to BOTH containers.** In split view, `#old-content` and `#new-content` scroll in sync. If a hunk header appears in `#new-content` but not `#old-content`, the two panes go out of alignment. The helper `createHunkHeaderElement(hunk, 'split')` returns elements with equal fixed height on both sides (ensured by CSS from commit 004).

6. **Collapsed sections also appended to BOTH containers** for the same alignment reason. The collapsed-section elements from commit 004 have a fixed height and matching structure on both sides.

7. **Empty hunk edge case.** If `groupIntoHunks()` returns zero hunks (e.g., the files are identical), skip Phase 2 entirely. The containers remain empty, which is the correct behavior.

8. **Comment rendering on collapsed lines.** If a comment exists on a line inside a collapsed section, the comment indicator won't be visible (the line isn't in the DOM). The indicator bar still shows the comment mark via `alignedDiffInfo`. Expanding collapsed sections to reveal comments is a future enhancement.

9. **Trailing collapsed count.** `groupIntoHunks()` from commit 003 tracks `precedingCollapsedCount` per hunk, but doesn't report trailing lines after the last hunk. Calculate this as `aligned.length - (index of last hunk's last line in aligned) - 1`. If `groupIntoHunks()` already handles this, use the provided value instead.

## Tests

- **Build verification:** `npm run build` must succeed with no type errors.
- **Manual test — large file diff:** Open a committed file diff where 2 lines changed in a 500+ line file. Split view should show `@@ … @@` headers, the changed lines with surrounding context, and collapsed placeholders for the hidden ranges. Changes should be visible without scrolling.
- **Manual test — indicator bar:** The minimap bar should still show colored marks at correct proportional positions for additions, deletions, and comments.
- **Manual test — scroll sync:** Scrolling one pane should scroll the other. Hunk headers should stay aligned between panes.
- **Manual test — comments:** Existing comments on visible lines should display their 💬 indicators and highlighted backgrounds. Comments on collapsed lines should show in the indicator bar.
- **Manual test — all-context file:** Opening a diff with no changes should show an empty view (no hunks to render).

## Acceptance Criteria

- [ ] Split view renders hunks with `@@ … @@` header elements between context groups
- [ ] Collapsed-section placeholders appear between hunks and show line count
- [ ] Collapsed-section placeholders appear at top/bottom when context lines are hidden there
- [ ] `alignedDiffInfo[]` contains entries for ALL aligned lines (not just visible ones)
- [ ] `lineToIndexMap` contains mappings for ALL lines (not just visible ones)
- [ ] Indicator bar renders correctly using percentage-based positioning
- [ ] Scroll sync works — both panes scroll together, hunk headers stay aligned
- [ ] Comments on visible lines render normally (indicator + highlight)
- [ ] `scrollToFirstChange()` still scrolls to the first visible change
- [ ] No TypeScript build errors

## Dependencies

- Depends on: 003 (`groupIntoHunks()` function and `Hunk` interface), 004 (`createHunkHeaderElement()`, `createCollapsedSectionElement()`, and associated CSS)

## Assumed Prior State

`groupIntoHunks(aligned, contextLines)` exists (commit 003) and returns `Hunk[]` where each hunk has `headerText`, `lines: AlignedLine[]`, line number ranges, and `precedingCollapsedCount`. `createHunkHeaderElement(hunk, viewMode)` and `createCollapsedSectionElement(count, hunkIndex)` exist with CSS for `.hunk-separator`, `.hunk-header`, `.collapsed-section`, `.expand-btn` (commit 004). CSS has GitHub diff colors (commit 002) and no gutter/pane borders (commit 001). `renderSplitDiff()` currently iterates a flat `AlignedLine[]` array and appends every line to the DOM.
