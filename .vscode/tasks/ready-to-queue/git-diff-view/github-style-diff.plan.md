# GitHub/ADO-Style Diff View

## Problem

The rendered file-based git diff view has two issues:
1. **Diff changes not visible** — When opening a full-file diff, the view renders from line 1 but `scrollToFirstChange()` is never called on initial load, so changes below the fold appear missing.
2. **Unwanted line borders** — Gutter `border-right` separators and pane borders create a VS Code-native look that doesn't match GitHub/Azure DevOps.
3. **Overall styling mismatch** — Colors, gutter layout, and row styling differ significantly from GitHub/ADO diff views.

## Target

Match the visual appearance of **GitHub's unified/split diff view**:
- Bright green (`#e6ffec` / dark: `#1a4731`) background for additions
- Bright red (`#ffebe9` / dark: `#4c1d1d`) background for deletions
- Blue/grey hunk headers (`@@ ... @@`) as separator rows
- No gutter `border-right` — numbers blend into the row
- Separate old/new line number columns (not combined with prefix)
- `+`/`-` prefix in its own narrow column, colored green/red
- No borders between diff lines — flat, borderless rows
- Scroll to first change automatically on open

## Files to Change

| File | Changes |
|------|---------|
| `media/styles/diff-webview.css` | Restyle gutters, remove borders, update addition/deletion/hunk colors |
| `src/shortcuts/git-diff-comments/webview-scripts/diff-renderer.ts` | Add hunk header rows, restructure gutter columns, scroll-to-first-change |
| `src/shortcuts/git-diff-comments/webview-scripts/main.ts` | Call `scrollToFirstChange()` after initial `renderDiff()` |
| `src/shortcuts/git-diff-comments/diff-review-editor-provider.ts` | Fix range-diff re-open bug (uses wrong diff function for existing panels) |

## Todos

### 1. fix-scroll-to-change
**Fix: Call `scrollToFirstChange()` on initial render**

In `main.ts`, after the `renderDiff()` call in `initialize()` (~line 85), add the missing `scrollToFirstChange()` call — mirroring what the `update` message handler already does at lines 122–125:
```ts
renderDiff();
if (getFullFileView()) {
    scrollToFirstChange();
}
```

### 2. remove-gutter-borders
**Remove all border-right from gutters and border between panes**

In `diff-webview.css`:
- Remove `border-right: 1px solid var(--vscode-panel-border)` from `.line-gutter` (line 359)
- Remove `border-right: 1px solid var(--vscode-panel-border)` from `.inline-line-gutter` (line 564)
- Remove `border-right: 1px solid var(--vscode-panel-border)` from `.diff-pane` (line 291)
- Keep `.diff-header` and `.pane-header` bottom borders (those are structural separators, not line-level)

### 3. github-style-colors
**Update diff row background colors to match GitHub**

In `diff-webview.css`, update the line-type colors:

| Type | Current | Target (light) | Target (dark) |
|------|---------|----------------|---------------|
| Addition bg | `rgba(155,185,85,0.2)` | `#dafbe1` | `rgba(46,160,67,0.15)` |
| Deletion bg | `rgba(255,0,0,0.2)` | `#ffebe9` | `rgba(248,81,73,0.15)` |
| Addition gutter bg | (inherits row) | `#ccffd8` | `rgba(46,160,67,0.25)` |
| Deletion gutter bg | (inherits row) | `#ffd7d5` | `rgba(248,81,73,0.25)` |
| Hunk header | (none) | `#ddf4ff` | `rgba(56,139,253,0.15)` |
| Context | transparent | transparent | transparent |

Use CSS variables with theme-aware fallbacks (leverage `body.vscode-light` / `body.vscode-dark` classes).

### 4. add-hunk-headers
**Render `@@ ... @@` hunk separator rows**

In `diff-renderer.ts`, when walking the diff and detecting non-contiguous line jumps (gap in line numbers), insert a hunk header row:
```html
<div class="diff-line diff-line-hunk">
  <div class="line-gutter hunk-gutter">...</div>
  <div class="line-content hunk-content">@@ -oldStart,oldCount +newStart,newCount @@</div>
</div>
```

Style in CSS with blue/grey background, collapsed height, italic text.

### 5. restructure-gutter-columns
**Separate old/new line number columns (inline view)**

Currently inline view has one `.inline-line-gutter` div containing both old and new numbers. Restructure to match GitHub's layout:
- Column 1: old line number (fixed width, right-aligned)
- Column 2: new line number (fixed width, right-aligned)
- Column 3: prefix (`+`/`-`/space, narrow)
- Content area

For split view, each pane already has a single line number — just ensure the prefix is in its own column separate from the number.

### 6. fix-range-diff-reopen
**Fix existing panel re-open for range diffs**

In `diff-review-editor-provider.ts` line ~284, the existing-panel path always calls `getDiffContent()` even for range diffs. It should mirror the new-panel path (lines 324–326):
```ts
const diffResult = isRangeFile && rangeInfo
    ? getRangeDiffContent(relativePath, rangeInfo.baseRef, rangeInfo.headRef, gitContext.repositoryRoot)
    : getDiffContent(relativePath, gitContext);
```

## Dependency Order

```
fix-scroll-to-change          (independent, quick fix)
remove-gutter-borders          (independent, CSS only)
github-style-colors            (independent, CSS only)
add-hunk-headers               (depends on: github-style-colors for hunk CSS)
restructure-gutter-columns     (depends on: remove-gutter-borders)
fix-range-diff-reopen          (independent, provider fix)
```

## Notes

- All CSS changes should respect VS Code theme variables where possible, falling back to GitHub-style hardcoded colors
- Dark theme colors should match GitHub's dark mode palette
- The hunk header detection logic should work for both split and inline views
- Comment indicators positioning may need adjustment after gutter restructure
- Test with: committed file diffs, range diffs (branch comparisons), and working-tree diffs
