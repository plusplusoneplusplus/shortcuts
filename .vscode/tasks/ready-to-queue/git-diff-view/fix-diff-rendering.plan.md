# Fix File-Based Git Diff View Rendering

## Problem

The rendered file-based git diff view in the `git-diff-comments` custom editor has three issues:

1. **Diff not showing** — The current implementation renders the **entire file** line-by-line using an LCS algorithm, treating every line as context/addition/deletion. Unlike GitHub/Azure DevOps, it does not collapse unchanged regions into expandable hunks. This means on large files with few changes, the diff is buried in hundreds of context lines making it appear as if "the diff isn't showing."
2. **Unwanted line borders** — `.line-gutter` and `.inline-line-gutter` both have `border-right: 1px solid var(--vscode-panel-border)` separating the gutter from content. GitHub and ADO don't have this border.
3. **Styling doesn't match GitHub/ADO** — The view needs visual parity with GitHub's unified/split diff: hunk headers (`@@ -X,Y +A,B @@`), collapsed unchanged sections, cleaner gutter styling, and subtle color scheme.

## Affected Files

| File | Role |
|------|------|
| `src/shortcuts/git-diff-comments/webview-scripts/diff-renderer.ts` | Core rendering logic — LCS, line elements, split/inline renderers |
| `media/styles/diff-webview.css` | All diff styling — gutter, line types, inline view, borders |
| `src/shortcuts/git-diff-comments/diff-review-editor-provider.ts` | HTML template generation, state passing to webview |
| `src/shortcuts/git-diff-comments/webview-scripts/main.ts` | Message handling, render triggers |
| `src/shortcuts/git-diff-comments/webview-scripts/state.ts` | View state management |

## Approach

### Phase 1: Remove Gutter Borders

Remove the `border-right` from `.line-gutter` and `.inline-line-gutter` in `diff-webview.css`.

**CSS changes:**
- `media/styles/diff-webview.css` line 359: remove `border-right: 1px solid var(--vscode-panel-border);` from `.line-gutter`
- `media/styles/diff-webview.css` line 564: remove `border-right: 1px solid var(--vscode-panel-border);` from `.inline-line-gutter`

### Phase 2: Hunk-Based Rendering (Core Fix)

The diff is currently rendered by iterating **all** aligned lines from the LCS output. Instead, implement **hunk-based collapsing** like GitHub/ADO:

1. **After LCS alignment**, group consecutive additions/deletions into hunks with N context lines before/after (default: 3 lines, matching `git diff` convention).
2. **Between hunks**, insert an expandable separator row showing `@@ -oldStart,oldCount +newStart,newCount @@` with a "show more" affordance.
3. **Collapsed sections** should be clickable to expand (show hidden context lines).

**Implementation in `diff-renderer.ts`:**
- Add `groupIntoHunks(aligned: AlignedLine[], contextLines: number): Hunk[]` function
- Each `Hunk` contains: `{ headerText: string, lines: AlignedLine[], startOldLine: number, startNewLine: number }`
- Modify `renderSplitDiff()` and `renderInlineDiff()` to iterate hunks instead of raw aligned lines
- Add `createHunkHeaderElement(hunk)` that renders the `@@` separator row
- Add `createCollapsedSection(count)` for collapsed context between hunks

**New DOM structure per hunk (split view):**
```
<div class="hunk-separator">
  <span class="hunk-header">@@ -10,7 +10,9 @@</span>
  <button class="expand-btn">Show 42 hidden lines</button>
</div>
<div class="diff-line diff-line-context">...</div>  <!-- 3 context lines -->
<div class="diff-line diff-line-deletion">...</div>  <!-- changed lines -->
<div class="diff-line diff-line-addition">...</div>
<div class="diff-line diff-line-context">...</div>  <!-- 3 context lines -->
```

### Phase 3: GitHub/ADO Visual Parity

Update CSS to match the clean aesthetic of GitHub/ADO diff views:

1. **Hunk separator styling** — Light gray background bar spanning full width, monospace `@@` text in muted color
2. **Gutter styling** — No right border, subtle background difference, line numbers in muted gray (not colored per side in inline view — GitHub uses gray for both)
3. **Line backgrounds** — Keep current green/red tints but ensure they match VS Code's diff editor variables (already close)
4. **Prefix characters** — `+` / `-` in the gutter without bold weight (GitHub uses normal weight)
5. **Pane headers** — Consider removing "Old Version" / "New Version" text labels (GitHub shows file path instead)
6. **Remove diagonal fill** for empty alignment lines — use plain transparent background

**Specific CSS changes:**
- `.line-gutter`: Remove `border-right`, reduce `min-width` to ~40px
- `.inline-line-gutter`: Remove `border-right`, use consistent muted color for both line number columns
- `.line-prefix`: Remove `font-weight: 600` (use normal weight)
- Add `.hunk-separator` styles: full-width bar, `background-color: var(--vscode-editorGroupHeader-tabsBackground)`, light blue/gray text
- `.diff-line-empty`: Use transparent background instead of diagonal fill
- `.inline-line-gutter .old-line-num` / `.new-line-num`: Use same muted gray color for both (not red/green)

### Phase 4: Expand/Collapse Interaction

Add JavaScript to handle expanding collapsed sections:

1. Click on "Show N hidden lines" button → replace the collapsed placeholder with the actual hidden context lines
2. Store expanded state in the webview so it persists during the session
3. Ensure the indicator bar (minimap) updates when sections are expanded

## Todos

1. **remove-gutter-borders** — Remove `border-right` from `.line-gutter` and `.inline-line-gutter` in CSS
2. **implement-hunk-grouping** — Add `groupIntoHunks()` function in `diff-renderer.ts` to collapse context lines between changes
3. **render-hunk-headers** — Create `@@` hunk header separator elements and collapsed section placeholders
4. **update-split-renderer** — Modify `renderSplitDiff()` to use hunk-based rendering
5. **update-inline-renderer** — Modify `renderInlineDiff()` to use hunk-based rendering
6. **style-github-parity** — Update CSS for GitHub/ADO visual parity (gutter, prefix, hunk bars, empty lines, inline line numbers)
7. **expand-collapse-logic** — Add click handler to expand collapsed sections and update indicator bar
8. **update-indicator-bar** — Ensure indicator bar reflects hunk-based view and responds to expand/collapse
9. **test-and-verify** — Build, verify no regressions in existing comment/navigation features

## Notes

- The LCS algorithm itself is correct and should be kept — only the rendering layer needs to change (grouping output into hunks)
- Comment indicators and click-to-comment must still work within hunks
- The editable mode (for uncommitted changes) must also respect hunk boundaries
- Scroll sync between split panes must account for hunk headers being the same height on both sides
- The existing `alignedDiffInfo` / `lineToIndexMap` data structures need updating for hunk-aware navigation (prev/next change buttons)
