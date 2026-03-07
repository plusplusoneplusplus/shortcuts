# Full-File Diff View for Commit Files

## Problem

When a user clicks a file inside a commit in the git tree view, the current viewer only shows **diff hunks** — the changed chunks with surrounding context lines. This makes it hard to understand the file as a whole. Additionally, `+`/`-` markers are rendered as text inside the line gutter, which means they get copied when the user selects and copies code.

## Proposed Approach

Render the **entire new file** (or old file for deletions) when viewing a committed file, overlaying diff highlighting on changed lines. Move the `+`/`-` gutter markers to CSS-only pseudo-elements (or apply `user-select: none`) so they are never included in clipboard copies.

---

## Scope

- Affects the **git-diff-comments** webview (`diff-renderer.ts`, `diff-review-editor-provider.ts`, `diff-content-provider.ts`)
- Applies only to the **committed file** view (not staged/unstaged diffs, unless desired)
- Split view and inline view both need to be updated

---

## Key Files

| File | Role |
|------|------|
| `src/shortcuts/git-diff-comments/webview-scripts/diff-renderer.ts` | Core rendering logic — LCS diff, line element creation, split/inline views |
| `src/shortcuts/git-diff-comments/diff-content-provider.ts` | Fetches `oldContent` / `newContent` via git |
| `src/shortcuts/git-diff-comments/diff-review-editor-provider.ts` | Opens webview, passes content + context |
| `src/shortcuts/git-diff-comments/webview-scripts/` | CSS, highlight, other scripts |

---

## Implementation Plan

### 1. Add "full-file" render mode flag

- In `diff-review-editor-provider.ts`, when the source is a `commitFile`, set a flag `fullFileView: true` in the webview state/message payload.
- Pass this flag through to the renderer.

### 2. Change diff rendering to show entire file

**In `diff-renderer.ts`:**

- When `fullFileView` is `true`, instead of only emitting changed hunks + nearby context, emit **every line** of the new file (or old file for pure deletions).
- Lines that are `addition` keep their green highlight; lines that are `deletion` keep their red highlight; all other lines render as neutral context.
- For **split view**: left pane shows old file (full), right pane shows new file (full), aligned by LCS as today but without collapsing unchanged regions.
- For **inline view**: output all lines of the merged sequence in order.
- Optional: add a "collapse unchanged regions" toggle button later (not in this plan).

### 3. Remove +/- from selectable text

**In `diff-renderer.ts`, `createLineElement()`:**

- Keep the `+`/`-` visual indicator in the gutter (`line-gutter`), but make it **CSS-only** so it is excluded from clipboard selection.
- Approach: set `user-select: none` on `.line-prefix` (or `.line-gutter`) in the stylesheet.
- The `prefixSpan.textContent` can keep its value for visual rendering, but the CSS rule prevents it from being selected/copied.

```css
/* In diff-styles or inline <style> */
.line-gutter {
    user-select: none;
}
```

This is the minimal change: no DOM restructuring needed, just a CSS property.

### 4. Scroll-to-first-change on open

When the webview opens in full-file mode, automatically scroll to the first added or deleted line so the user immediately sees what changed, without losing the ability to scroll to the top.

- After rendering, emit a `scrollToFirstChange` message from the renderer (or use `document.querySelector('.line-added, .line-deleted')?.scrollIntoView()`).

### 5. (Optional) Visual separator for changed regions

Add a subtle left-border or background stripe to visually group changed hunks within the full file, making them easier to scan. This is purely CSS and can be done independently.

---

## Non-Goals

- No changes to staged/unstaged diff views (those are interactive/editable)
- No changes to AI review or comment functionality
- No changes to the CoC CLI or pipeline-core packages

---

## Tasks

1. **Add `fullFileView` flag** — propagate from `diff-review-editor-provider.ts` → webview message → `diff-renderer.ts`
2. **Render full file in inline view** — modify `renderInlineDiff()` to emit all lines when `fullFileView=true`
3. **Render full file in split view** — modify `renderSplitDiff()` similarly
4. **CSS: `user-select: none` on `.line-gutter`** — single CSS rule, fixes copy-paste issue
5. **Auto-scroll to first change** — add post-render scroll logic
6. **Tests** — update/add unit tests for the renderer if a test harness exists

---

## Notes

- The `oldContent` and `newContent` are already full file strings (fetched via `git show`); no changes to `diff-content-provider.ts` are needed.
- For **deleted files** (`newContent` is empty), show the old file entirely in red.
- For **added files** (`oldContent` is empty), show the new file entirely in green.
- LCS computation on large files may be slow; consider capping lines or using a faster diff library if performance is a concern (out of scope for now).
