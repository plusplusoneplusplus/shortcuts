---
status: pending
---

# 002: GitHub-style diff colors and theme support

## Summary

Replace diff backgrounds, inline line-number colors, and empty-line fill with GitHub-aligned values that adapt to VS Code light and dark themes via CSS custom properties with per-theme fallbacks.

## Motivation

Current diff colors (`rgba(155,185,85,0.2)` additions, `rgba(255,0,0,0.2)` deletions) are desaturated and don't match GitHub/ADO visual conventions. Inline line numbers use distracting red/green coloring instead of a muted gray. Empty (filler) lines use `diagonalFill` hatching which adds visual noise. This commit corrects all color values in a single pass.

## Changes

### Files to Create

- (none)

### Files to Modify

- `media/styles/diff-webview.css` — Update diff row backgrounds, gutter backgrounds, inline line-number colors, and empty-line fill to match GitHub palette with light/dark theme awareness.

### Files to Delete

- (none)

## Implementation Notes

### Approach: CSS custom properties with `body.vscode-light` / `body.vscode-dark` overrides

VS Code webviews apply `body.vscode-light`, `body.vscode-dark`, or `body.vscode-high-contrast` classes automatically. We define custom properties at `body` scope with dark-theme defaults, then override under `body.vscode-light`. This is cleaner than duplicating every rule.

Add the following block near the top of the file (after the `html, body` rule, around line 21):

```css
/* GitHub-style diff color tokens */
body {
    --diff-addition-bg: rgba(46, 160, 67, 0.15);
    --diff-addition-gutter-bg: rgba(46, 160, 67, 0.25);
    --diff-deletion-bg: rgba(248, 81, 73, 0.15);
    --diff-deletion-gutter-bg: rgba(248, 81, 73, 0.25);
}

body.vscode-light {
    --diff-addition-bg: #dafbe1;
    --diff-addition-gutter-bg: #ccffd8;
    --diff-deletion-bg: #ffebe9;
    --diff-deletion-gutter-bg: #ffd7d5;
}
```

### Change 1 — Side-by-side addition row background (lines 435-438)

```css
/* BEFORE */
.diff-line-addition,
.line-added {
    background-color: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.2));
}

/* AFTER */
.diff-line-addition,
.line-added {
    background-color: var(--diff-addition-bg);
}
```

### Change 2 — Side-by-side deletion row background (lines 445-448)

```css
/* BEFORE */
.diff-line-deletion,
.line-deleted {
    background-color: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.2));
}

/* AFTER */
.diff-line-deletion,
.line-deleted {
    background-color: var(--diff-deletion-bg);
}
```

### Change 3 — Gutter backgrounds for addition/deletion rows (NEW rules, insert after change 1 and change 2 respectively)

Add gutter-specific backgrounds that are slightly more saturated than the row, matching GitHub's visual hierarchy where the gutter stripe is darker than the row.

Insert after `.diff-line-addition .line-gutter .line-prefix` block (after line 443):

```css
.diff-line-addition .line-gutter,
.line-added .line-gutter {
    background-color: var(--diff-addition-gutter-bg);
}
```

Insert after `.diff-line-deletion .line-gutter .line-prefix` block (after line 453):

```css
.diff-line-deletion .line-gutter,
.line-deleted .line-gutter {
    background-color: var(--diff-deletion-gutter-bg);
}
```

### Change 4 — Empty line: remove diagonal fill (lines 455-461)

```css
/* BEFORE */
.diff-line-empty {
    background-color: var(--vscode-diffEditor-diagonalFill, rgba(128, 128, 128, 0.1));
}

.diff-line-empty .line-gutter {
    background-color: var(--vscode-diffEditor-diagonalFill, rgba(128, 128, 128, 0.1));
}

/* AFTER */
.diff-line-empty {
    background-color: transparent;
}

.diff-line-empty .line-gutter {
    background-color: transparent;
}
```

### Change 5 — Inline line numbers: red/green → muted gray (lines 604-612)

```css
/* BEFORE */
.inline-line-gutter .old-line-num {
    color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c);
    opacity: 0.8;
}

.inline-line-gutter .new-line-num {
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
    opacity: 0.8;
}

/* AFTER */
.inline-line-gutter .old-line-num {
    color: var(--vscode-editorLineNumber-foreground);
    opacity: 1;
}

.inline-line-gutter .new-line-num {
    color: var(--vscode-editorLineNumber-foreground);
    opacity: 1;
}
```

Note: The context-line override at lines 614-618 already sets the same value, so that block can remain as-is for clarity (it becomes a no-op but documents intent).

### Change 6 — Inline view addition/deletion row backgrounds (lines 632-645)

```css
/* BEFORE */
.inline-diff-line-addition {
    background-color: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.2));
}
/* ... */
.inline-diff-line-deletion {
    background-color: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.2));
}

/* AFTER */
.inline-diff-line-addition {
    background-color: var(--diff-addition-bg);
}
/* ... */
.inline-diff-line-deletion {
    background-color: var(--diff-deletion-bg);
}
```

### Change 7 — Inline view gutter backgrounds (NEW rules, insert after inline addition/deletion blocks)

Insert after `.inline-diff-line-deletion .inline-line-gutter .line-prefix` block (after line 646):

```css
.inline-diff-line-addition .inline-line-gutter {
    background-color: var(--diff-addition-gutter-bg);
}

.inline-diff-line-deletion .inline-line-gutter {
    background-color: var(--diff-deletion-gutter-bg);
}
```

## Tests

- Build must pass: `npm run build`
- Visual verification in VS Code light theme: addition rows `#dafbe1`, deletion rows `#ffebe9`, gutters slightly darker
- Visual verification in VS Code dark theme: addition rows have green tint, deletion rows have red tint
- Inline view line numbers are muted gray (same as context lines)
- Empty (filler) lines are fully transparent, no diagonal hatching

## Acceptance Criteria

- [ ] CSS custom properties `--diff-addition-bg`, `--diff-addition-gutter-bg`, `--diff-deletion-bg`, `--diff-deletion-gutter-bg` defined on `body` with dark defaults
- [ ] `body.vscode-light` overrides define GitHub light-mode colors (`#dafbe1`, `#ccffd8`, `#ffebe9`, `#ffd7d5`)
- [ ] Side-by-side `.diff-line-addition` and `.diff-line-deletion` use new custom properties
- [ ] Inline `.inline-diff-line-addition` and `.inline-diff-line-deletion` use new custom properties
- [ ] Gutter backgrounds for addition/deletion rows use `--diff-*-gutter-bg` (slightly more saturated)
- [ ] `.diff-line-empty` and its `.line-gutter` child use `transparent` (no diagonal fill)
- [ ] `.inline-line-gutter .old-line-num` and `.new-line-num` use `--vscode-editorLineNumber-foreground` with `opacity: 1`
- [ ] `npm run build` succeeds
- [ ] No `body.vscode-high-contrast` overrides needed (dark defaults work acceptably)

## Dependencies

- Depends on: 001 (borders removed, prefix weight normalized)

## Assumed Prior State

Borders removed from `.line-gutter`, `.inline-line-gutter`, `.diff-pane`. Prefix weight changed from `font-weight: 600` to `font-weight: normal` (commit 001).
