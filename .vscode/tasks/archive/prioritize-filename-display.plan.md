# Plan: Prioritize File Name in Branch Changes Tree View

## Problem

In the **Branch Changes** tree panel, files are currently displayed as truncated full relative paths (e.g., `docs/designs/coc-memory...`, `packages/coc/src/server/sp...`). When the path is long, the meaningful part — the **filename itself** — gets cut off. Users cannot easily scan which files changed at a glance.

The user wants:
1. **Label:** Show the filename (basename) prominently as the primary label.
2. **Hover tooltip:** Show the **complete, untruncated full path** when hovering over the item.

---

## Current State

**File:** `src/shortcuts/git/git-range-file-item.ts` — `GitRangeFileItem`

| Property | Current Value |
|---|---|
| `label` | `path.basename(file.path)` — ✅ already basename |
| `description` | `"M • docs/designs (+268/-55)"` — directory embedded, looks like a full path alongside label |
| `tooltip` | Markdown with `**Path:** \`${file.path}\`` — full path present but buried in markdown |

**File:** `src/shortcuts/git-diff-comments/diff-comments-tree-provider.ts` — `DiffCommentFileItem`

| Property | Current Value |
|---|---|
| `label` | `path.basename(filePath)` — ✅ already basename |
| `tooltip` | Plain text: `${filePath}\n${totalCount} comment(s)` |

### Root Cause

The `description` string in `GitRangeFileItem` currently includes the **directory path** inline (e.g., `M • docs/designs`). In VS Code's tree view, label + description are rendered side by side. When the tree is narrow, the description's directory prefix visually merges with the label, creating the illusion of a truncated full path. The filename itself can get cut off before the directory segment even appears.

---

## Proposed Changes

### 1. `GitRangeFileItem` — Reorganize `description` and `tooltip`

**`createDescription()`** — Remove the directory segment; keep status indicator and stats only.

```
Before: "M • docs/designs (+268/-55)"
After:  "M  (+268/-55)"
```

This makes the label (filename) the unambiguous focal point.

**`createTooltip()`** — Promote the full path to the **first line** of the tooltip, displayed as plain text (not buried in markdown), so it appears immediately on hover without scrolling.

```
Before (tooltip starts with):  **coc-memory.md**\n\n**Status:** ...
After (tooltip starts with):   docs/designs/coc-memory.md\n\n**Status:** ...
```

Ensure `tooltip` is a `vscode.MarkdownString` with the full path in a code block or bold at the top, with no truncation. VS Code tooltips render the full string — they do not clip.

### 2. `DiffCommentFileItem` — Improve tooltip

The label is already basename. The tooltip is plain text with full path, which is correct. No label changes needed.

Optionally, convert the tooltip to a `vscode.MarkdownString` to match `GitRangeFileItem` for consistency, and put the full path in a code fence so long paths render clearly.

---

## Files to Modify

| File | Change |
|---|---|
| `src/shortcuts/git/git-range-file-item.ts` | Remove dir from `description`; reorder `tooltip` to lead with full path |
| `src/shortcuts/git-diff-comments/diff-comments-tree-provider.ts` | (Optional) Improve tooltip to use `MarkdownString` with full path prominent |

---

## Out of Scope

- No changes to stats formatting (+N/-N)
- No changes to status indicator (M / A / D / R)
- No changes to command behavior or diff opening
- No changes to `GitCommitRangeItem` or `BranchChangesSectionItem`

---

## Acceptance Criteria

1. File items in the Branch Changes tree show **only the filename** as the label (no directory prefix visible in normal view).
2. Hovering any file item shows the **full relative path** (e.g., `packages/coc/src/server/spa/components/App.tsx`) **without truncation**.
3. The status indicator and change stats are still visible in the description.
4. Files with identical basenames in different directories remain distinguishable — the directory is shown in the tooltip, not in the label row.
