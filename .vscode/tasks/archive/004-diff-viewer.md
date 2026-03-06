---
status: pending
---

# 004: Add Diff Viewer

## Summary

Add syntax-highlighted unified diff rendering (`DiffViewer.tsx`) and read-only file-at-revision viewing (`FileContentViewer.tsx`) to the repos SPA, wired into the commit detail and file change list components from commit 003.

## Motivation

Users need to see actual code changes. The commit list (002) and commit detail expansion (003) show metadata and file lists, but the final step is rendering the diffs themselves. This commit adds the visual diff layer — the payoff of the entire feature.

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/repos/DiffViewer.tsx` — Unified diff renderer that parses raw git diff text into styled hunks with line numbers, add/remove highlighting, hunk headers, and large-diff truncation.
- `packages/coc/src/server/spa/client/react/repos/FileContentViewer.tsx` — Fetches and displays file content at a specific commit revision with line numbers and syntax highlighting.

### Files to Modify

- `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` — Add "View Full Diff" button that fetches full commit diff and renders `<DiffViewer>`.
- `packages/coc/src/server/spa/client/react/repos/FileChangeList.tsx` — Wire file row click to fetch per-file diff and render `<DiffViewer>` inline; add "View File" button to open `<FileContentViewer>`.
- `packages/coc/src/server/spa/client/tailwind.css` — Add diff-specific styles for hunk headers, line-number gutters, sticky file headers, and the file content viewer. Extend existing `.diff-*` classes.

## Implementation Notes

### DiffViewer.tsx

**Props interface:**
```typescript
interface DiffViewerProps {
    diff: string;           // raw unified diff text from git
    maxLines?: number;      // truncation threshold, default 500
    defaultCollapsed?: boolean; // collapse unchanged context by default
}
```

**Diff parsing strategy:** Parse the raw unified diff string line-by-line. No external library needed — unified diff format is straightforward:
1. Split on `\n`
2. Detect file headers: lines starting with `diff --git`, `---`, `+++`
3. Detect hunk headers: lines matching `^@@\s`; extract line numbers from `@@ -a,b +c,d @@`
4. Classify remaining lines: `+` → added, `-` → removed, ` ` → context
5. Track old/new line numbers per hunk for the gutter

**Internal types:**
```typescript
type DiffLineType = 'added' | 'removed' | 'context' | 'hunk-header' | 'file-header';

interface ParsedDiffLine {
    type: DiffLineType;
    content: string;
    oldLineNum?: number;  // undefined for added lines
    newLineNum?: number;  // undefined for removed lines
}

interface DiffHunk {
    header: string;       // the @@ line
    lines: ParsedDiffLine[];
}

interface DiffFile {
    oldPath: string;
    newPath: string;
    hunks: DiffHunk[];
    isBinary: boolean;
}
```

**Rendering approach:**
- Reuse existing CSS classes: `.diff-container`, `.diff-line`, `.diff-line-added`, `.diff-line-removed`, `.diff-line-context`, `.diff-line-prefix` from `tailwind.css` (lines 1036-1088). Follow the same pattern as `DiffView` in `ToolCallView.tsx` (line 162-183).
- Add new classes for hunk headers (`.diff-hunk-header`) and line-number gutters (`.diff-gutter`).
- File headers (`diff --git ...`, `--- a/`, `+++ b/`) rendered with `position: sticky; top: 0` so they stay visible during scroll within a scrollable diff container.
- Line-number gutter: two columns (old/new) in muted text, fixed-width, non-selectable (`user-select: none`).

**Large diff truncation:**
- Count total lines after parsing. If > `maxLines` (default 500), render only the first 500 lines.
- Show a bar: `"Diff too large — showing first 500 of {N} lines."` with a `[Show All]` button that sets a `showAll` state.

**Binary file detection:**
- If a file section contains `Binary files ... differ` (git's standard output), render a simple message: `"Binary file — no diff available"` with a muted info icon.

**Collapsible context regions:**
- *Stretch goal / optional.* If implemented: group consecutive context lines >6 into a collapsible region showing first 3 and last 3 with an `"... N hidden lines ..."` expander. This adds complexity; defer if time-constrained.

### FileContentViewer.tsx

**Props interface:**
```typescript
interface FileContentViewerProps {
    workspaceId: string;
    commitHash: string;
    filePath: string;
    onClose: () => void;
}
```

**Data fetching:**
- `GET /api/workspaces/${workspaceId}/git/commits/${commitHash}/files/${encodeURIComponent(filePath)}/content`
- Backend calls `GitLogService.getFileContentAtCommit(repoRoot, commitHash, filePath)` which runs `git show "${commitHash}:${normalizedPath}"`.
- Handle 404 / empty response for deleted files: show `"File not found at this revision"`.

**Rendering:**
- Header: `"{filename} @ {shortHash}"` (first 7 chars of commit hash) with a close button.
- Content: monospace `<pre>` with line numbers in a gutter column, matching the font stack from `tailwind.css` (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, ...`).
- Syntax highlighting: use the CDN-loaded `hljs` global (already declared in `globals.d.ts`, loaded in `html-template.ts`). After render, call `hljs.highlightElement()` on the code block. Detect language from file extension.
- Wrap in a container with max-height and `overflow-y: auto`.

### CommitDetail.tsx Modifications

- Add state: `const [fullDiff, setFullDiff] = useState<string | null>(null)` and `const [loadingDiff, setLoadingDiff] = useState(false)`.
- Add a "View Full Diff" `<Button>` in the commit detail header area (next to existing metadata).
- On click: fetch `GET /api/workspaces/${workspaceId}/git/commits/${hash}/diff`. Set `fullDiff` to `data.diff`.
- When `fullDiff` is set, render `<DiffViewer diff={fullDiff} />` below the file change list.
- Toggle behavior: clicking again collapses (sets `fullDiff` back to `null`).

### FileChangeList.tsx Modifications

- Add state: `const [expandedFile, setExpandedFile] = useState<string | null>(null)` (tracks which file path is showing its diff).
- Add state: `const [fileDiffs, setFileDiffs] = useState<Record<string, string>>({})` (cache fetched diffs).
- Add state: `const [viewingFile, setViewingFile] = useState<string | null>(null)` (file content viewer).
- On file row click: if already expanded, collapse. Otherwise fetch `GET /api/workspaces/${workspaceId}/git/commits/${hash}/files/${encodeURIComponent(path)}/diff` and cache in `fileDiffs`. Set `expandedFile` to that path.
- Below each expanded file row, render `<DiffViewer diff={fileDiffs[path]} />`.
- "View File" icon button on each row: sets `viewingFile` to that path, renders `<FileContentViewer>` in a dialog or slide-out panel.
- Use `fetchApi` from `../hooks/useApi` for all API calls (consistent with codebase pattern).

### CSS Additions (`tailwind.css`)

Append to the existing `/* ── Diff rendering ── */` section (~line 1088):

```css
/* ── Git commit diff viewer ── */

.diff-hunk-header {
    background: rgba(56, 132, 244, 0.08);
    color: #0078d4;
    font-weight: 600;
    padding: 2px 8px;
    font-size: 11px;
    border-top: 1px solid #e0e0e0;
}

.dark .diff-hunk-header {
    background: rgba(55, 148, 255, 0.1);
    color: #3794ff;
    border-top-color: #3c3c3c;
}

.diff-file-header {
    background: #f3f3f3;
    padding: 6px 10px;
    font-weight: 600;
    font-size: 12px;
    color: #1e1e1e;
    border-bottom: 1px solid #e0e0e0;
    position: sticky;
    top: 0;
    z-index: 5;
}

.dark .diff-file-header {
    background: #252526;
    color: #cccccc;
    border-bottom-color: #3c3c3c;
}

.diff-gutter {
    display: inline-block;
    width: 70px;
    text-align: right;
    padding-right: 8px;
    color: #848484;
    user-select: none;
    font-size: 10px;
    border-right: 1px solid #e0e0e0;
    margin-right: 8px;
}

.dark .diff-gutter {
    border-right-color: #3c3c3c;
}

.diff-truncated-bar {
    padding: 8px 12px;
    text-align: center;
    font-size: 12px;
    color: #848484;
    background: #f9f9f9;
    border-top: 1px solid #e0e0e0;
}

.dark .diff-truncated-bar {
    background: #1e1e1e;
    border-top-color: #3c3c3c;
}

.diff-binary-notice {
    padding: 12px;
    text-align: center;
    font-size: 12px;
    color: #848484;
    font-style: italic;
}

.file-content-viewer {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    line-height: 1.5;
}

.file-content-viewer .line-number {
    display: inline-block;
    width: 50px;
    text-align: right;
    padding-right: 12px;
    color: #848484;
    user-select: none;
}
```

## Patterns to Follow

- **Data fetching:** Use `fetchApi(path)` from `../hooks/useApi` — returns parsed JSON, throws on non-OK. Match the pattern in `RepoInfoTab.tsx` (useEffect + fetchApi + loading/error states).
- **Styling:** Tailwind utility classes with hardcoded hex colors + `dark:` prefix for dark mode. Use `cn()` from shared for conditional classes. Match the exact color palette used in existing repos components (`#1e1e1e`, `#cccccc`, `#848484`, `#e0e0e0`, `#3c3c3c`, `#0078d4`, `#3794ff`).
- **Component exports:** Named exports, interface types exported alongside component. JSDoc comment at top of file describing purpose.
- **Existing diff CSS:** Reuse `.diff-container`, `.diff-line`, `.diff-line-added`, `.diff-line-removed`, `.diff-line-context`, `.diff-line-prefix` (tailwind.css lines 1036-1088). The `DiffView` component in `ToolCallView.tsx` (line 162) is the closest existing reference implementation.
- **Syntax highlighting:** `hljs` is a CDN-loaded global (highlight.js 11.9.0). Use `useEffect` + `useRef` to call `hljs.highlightElement()` after render, matching the pattern in the wiki SPA's `markdown.ts`.
- **Shared components:** Import `Button`, `Spinner`, `cn` from `../shared`.

## API Endpoints (from Commit 001)

| Endpoint | Returns | Backend Method |
|----------|---------|----------------|
| `GET /api/workspaces/:id/git/commits/:hash/diff` | `{ diff: string }` — raw unified diff | `GitLogService.getCommitDiff(repoRoot, hash)` |
| `GET /api/workspaces/:id/git/commits/:hash/files/:path/diff` | `{ diff: string }` — per-file diff | `git diff parentHash commitHash -- filePath` |
| `GET /api/workspaces/:id/git/commits/:hash/files/:path/content` | `{ content: string }` — file at revision | `GitLogService.getFileContentAtCommit(repoRoot, hash, filePath)` |

Note: `filePath` in URL must be `encodeURIComponent`-encoded since paths contain `/`.

## Tests

- **DiffViewer parsing:** raw unified diff string → correct `ParsedDiffLine[]` with types and line numbers
- **Added/removed/context line styling:** lines get correct `.diff-line-added`, `.diff-line-removed`, `.diff-line-context` classes
- **Hunk header rendering:** `@@` lines rendered with `.diff-hunk-header` class, correct extracted line numbers
- **File header rendering:** `diff --git` headers rendered with `.diff-file-header` class and sticky positioning
- **Large diff truncation:** diff with >500 lines shows truncation bar; clicking "Show All" reveals full diff
- **Binary file detection:** diff containing `Binary files ... differ` renders `.diff-binary-notice` message
- **Empty diff handling:** empty string prop renders "No changes" message
- **FileContentViewer fetch:** mounts, calls correct API endpoint, renders content with line numbers
- **FileContentViewer 404:** deleted file shows "File not found at this revision"
- **FileChangeList click → per-file diff:** clicking file row fetches diff, renders `<DiffViewer>` inline below row
- **FileChangeList toggle:** clicking expanded file row collapses it
- **FileChangeList diff caching:** expanding same file twice doesn't re-fetch
- **CommitDetail "View Full Diff":** button fetches full commit diff, renders `<DiffViewer>`
- **CommitDetail toggle:** clicking "View Full Diff" again collapses the diff
- **Dark/light theme:** diff colors match expected values for both themes (green/red in light; bright green/red in dark)

## Acceptance Criteria

- [ ] Click a file in commit detail → see syntax-highlighted per-file diff below the file row
- [ ] "View Full Diff" button on commit detail → see full commit diff with all files
- [ ] "View File" button on file row → see file content at that revision with line numbers
- [ ] Large diffs (>500 lines) truncated with "Show All" expand option
- [ ] Binary files show "Binary file — no diff available" instead of garbled content
- [ ] Empty diffs show a "No changes" message
- [ ] Line-number gutter shows old/new line numbers for each diff line
- [ ] Hunk headers (`@@ ... @@`) visually distinct with blue background
- [ ] File headers sticky during scroll within a diff section
- [ ] Works in both light and dark themes with correct color values
- [ ] Diff caching: re-expanding a file doesn't re-fetch from the API
- [ ] All existing SPA tests continue to pass

## Dependencies

- Depends on: 001 (API endpoints for diff and file content), 002 (History tab and commit list), 003 (CommitDetail.tsx and FileChangeList.tsx with expansion)

## Assumed Prior State

Commits 001-003 provide: git API endpoints for commit diff / per-file diff / file content at revision; a History tab with paginated commit list; and commit detail expansion with file change list. The `DiffViewer` and `FileContentViewer` are the final rendering layer that consumes the API and displays within the UI scaffolding.
