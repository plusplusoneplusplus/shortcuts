# Plan: Tool Call Preview for Glob and Grep

## Problem

The `glob` and `grep` tool calls in the CoC chat UI currently render their results only as collapsed plain `<pre><code>` text. There is no hover popover preview like `view`, `bash`, and `task` already have. The user wants rich, at-a-glance previews for these two common tools.

## Current State

- `ToolCallView.tsx` line 359: `hasHoverResult` only covers `task | view | bash`
- `ToolResultPopover.tsx`: branches for image / markdown / code-with-gutter / terminal / default
- `glob` and `grep` fall through to the generic "default" branch (plain `<pre>`) — no hover popover is wired at all

## Raw Result Formats

**glob** — one absolute path per line:
```
D:\projects\shortcuts\.vscode\tasks\coc\chat\foo.md
D:\projects\shortcuts\.vscode\tasks\coc\chat\bar.md
```

**grep** — ripgrep `file:line:content` per line:
```
src/foo.ts:12:export function doThing() {
src/bar.ts:45:    doThing();
```

## Proposed Approach

Wire both tools into the existing hover-popover mechanism and add purpose-built render branches in `ToolResultPopover`.

### Visual Design

**Glob preview** — styled file list:
- Header label: `"Glob Matches"` + match count badge (e.g. `12 files`)
- Each row: file icon + relative path (relative to workspace root, derived from `args.path`)
- Rows are scrollable (same max-height as existing popover: 300px)
- Clicking a file path → linkify (reuse existing `.file-path-link` mechanism if possible)

**Grep preview** — grouped match list:
- Header label: `"Grep Matches"` + match count badge (e.g. `7 matches in 3 files`)
- Grouped by file: file path as a sub-header, then indented `line: content` rows
- Matched pattern highlighted in the content (bold or colored)
- Scrollable

Both previews should use the same popover shell (width 600px, max-height 300px) as existing previews.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx` | Add `'glob'` and `'grep'` to `hasHoverResult` condition (line ~359) |
| `packages/coc/src/server/spa/client/react/processes/ToolResultPopover.tsx` | Add `isGlob` and `isGrep` branches in `renderBody()` + update header label |

No new files are strictly required; all changes are additive within existing components.

## Tasks

1. **Extend `hasHoverResult`** in `ToolCallView.tsx`
   - Add `|| name === 'glob' || name === 'grep'` to the condition

2. **Add `isGlob` / `isGrep` flags** in `ToolResultPopover.tsx`
   - Derive from `toolName` prop (same pattern as `isView`/`isBash`)

3. **Implement glob result parser**
   - Split result by newline, filter empty lines → string[]
   - Compute relative paths using `args.path` (workspace root) when available

4. **Implement grep result parser**
   - Parse each line into `{ file, line, content }` using `:` splitting (handle Windows paths with drive letters — split on first `:digit:` occurrence)
   - Group by file → `Map<string, Array<{line, content}>>`

5. **Render `GlobPreview` in `ToolResultPopover`**
   - Header: `"Glob Matches"` + `{count} files`
   - Scrollable list of file paths (with relative-path shortening)

6. **Render `GrepPreview` in `ToolResultPopover`**
   - Header: `"Grep Matches"` + `{matchCount} matches in {fileCount} files`
   - Per-file group: bold filename, then indented line-number + content rows
   - Highlight matched text (use `args.pattern` for the regex)

7. **Update popover header label** in `ToolResultPopover`
   - Add `isGlob ? 'Glob Matches' : isGrep ? 'Grep Matches' : ...` to the ternary

## Notes & Considerations

- **Windows paths**: grep line parsing must handle `C:\foo\bar.ts:12:content` — don't split on the drive colon. Safe heuristic: the path segment ends at the first `:` that is followed by a digit (line number).
- **Empty results**: show a "No matches found" placeholder instead of an empty list.
- **Large results**: cap rendered rows at ~100 (same spirit as `visibleText` truncation in current popover) to avoid DOM bloat.
- **Pattern highlighting**: `args.pattern` for grep may be a regex string; wrap in `try/catch` when constructing `RegExp`.
- No new dependencies needed — reuse existing CSS utility classes already in the SPA.
