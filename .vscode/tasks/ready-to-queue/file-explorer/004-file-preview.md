---
status: done
---

# 004: File Preview Pane

## Summary

Add a `<PreviewPane>` component that fetches file content from the blob API (commit 002) and renders it with syntax highlighting inside the split layout placeholder created by `<ExplorerPanel>` (commit 003). Single-click selects a tree node; double-click (or Enter on a file) opens the preview.

## Motivation

The file tree from commit 003 lets users navigate a repo's structure, but clicking a file currently does nothing beyond highlighting the row. The preview pane is a purely additive feature — the tree is fully functional without it. Splitting preview into its own commit keeps 003 focused on layout and tree mechanics, and lets this commit own all content-fetching, rendering, and highlighting logic in isolation.

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/repos/explorer/PreviewPane.tsx`

React component that renders file content in the right half of the `<ExplorerPanel>` split layout.

**Props:**

```ts
interface PreviewPaneProps {
  repoId: string;
  /** Relative path from repo root, e.g. "src/index.ts" */
  filePath: string;
  /** File name for language detection, e.g. "index.ts" */
  fileName: string;
}
```

**Rendering logic (by file type):**

| Category | Detection | Rendering |
|----------|-----------|-----------|
| **Source code** | `getLanguageFromFileName()` returns non-null | Line-numbered view with per-line `highlightLine()` via `useSyntaxHighlight.ts` — identical pattern to `CommitFileContent.tsx` lines 123-140 |
| **Markdown** | Extension `.md`, `.markdown`, `.mdx` | `renderMarkdownToHtml(content, { stripFrontmatter: true })` from `markdown-renderer.ts`, then post-render `hljs.highlightElement()` on `pre code` blocks — same pattern as `CommitFileContent.tsx` lines 58-71 |
| **Images** | MIME starts with `image/` (from blob response `mimeType` field) | `<img>` tag with `src` as data-URI (`data:{mimeType};base64,{content}`) |
| **Binary / unknown** | `encoding === 'base64'` and not an image | Placeholder: file icon + "Binary file — {size} bytes" + download link |
| **Empty file** | `content === ''` | Italic "(empty file)" message, matching `CommitFileContent.tsx` line 142 |
| **Oversized** | Content length > 512 KB | Truncate with "File too large to preview (showing first 512 KB)" banner |

**State machine:**

```
idle → loading → content | error
                 ↓
         (new filePath) → loading → ...
```

- `loading`: Centered `<Spinner size="sm" />` + "Loading {fileName}…" — matches `CommitFileContent.tsx` lines 100-103.
- `error`: Error message + "Retry" button that re-fetches — matches `CommitFileContent.tsx` lines 104-115.
- Fetch via `fetchApi(`/api/repos/${repoId}/blob?path=${encodeURIComponent(filePath)}`)`.
- Cancel in-flight request on path change (AbortController).

**Syntax highlighting approach:**

Import `getLanguageFromFileName`, `highlightLine`, `escapeHtml` from the existing `useSyntaxHighlight.ts` module at `../useSyntaxHighlight`. This file already registers 15 highlight.js languages (TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, C#, JSON, YAML, Bash, CSS, XML, Markdown) and provides per-line highlighting. The preview pane uses the exact same line-by-line rendering loop as `CommitFileContent.tsx`:

```tsx
<div className="font-mono text-xs leading-5">
  {lines.map((line, i) => (
    <div key={i} className="flex hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <span className="select-none text-right text-gray-400 pr-4 ..."
            style={{ minWidth: `${gutterWidth}ch` }}>
        {i + 1}
      </span>
      <span className="flex-1 whitespace-pre overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: highlightLine(line, language) }} />
    </div>
  ))}
</div>
```

No new highlight.js dependencies or CDN additions are needed — all highlighting infrastructure is already present.

### Files to Modify

#### `packages/coc/src/server/spa/client/react/repos/explorer/ExplorerPanel.tsx`

Commit 003 creates `ExplorerPanel` with a split layout that has a placeholder for the preview pane (right side). This commit wires in the real `<PreviewPane>`:

1. **Add state:** `const [previewFile, setPreviewFile] = useState<{ path: string; name: string } | null>(null);`
2. **Pass callback to `<FileTree>`:** `onFileOpen={entry => setPreviewFile({ path: entry.path, name: entry.name })}` — triggered on double-click / Enter on a file node.
3. **Render preview pane** in the right split area (replacing the placeholder):
   ```tsx
   <div className="flex-1 overflow-hidden border-l border-gray-200 dark:border-gray-700">
     {previewFile
       ? <PreviewPane repoId={repoId} filePath={previewFile.path} fileName={previewFile.name} />
       : <div className="flex items-center justify-center h-full text-gray-400 text-sm">
           Double-click a file to preview
         </div>}
   </div>
   ```
4. **Layout:** The split uses `flex flex-row` — tree pane gets `w-[320px] lg:w-[360px]` and the preview pane gets `flex-1`. This mirrors the `RepoGitTab.tsx` pattern (`lg:w-[320px]` aside + `flex-1` main).

#### `packages/coc/src/server/spa/client/react/repos/explorer/FileTree.tsx` (or `TreeNode.tsx`)

Add double-click handler to file nodes:

1. **New prop on `FileTree`:** `onFileOpen?: (entry: TreeEntry) => void`
2. **`TreeNode` file rows:** Add `onDoubleClick={() => onFileOpen?.(entry)}` to the file row `<div>`.
3. **Keyboard:** When a file node is focused and user presses `Enter` or `→`, call `onFileOpen(entry)` — consistent with the keyboard navigation table in the PRD.
4. Single-click continues to call the existing `onSelect(entry)` for highlighting only.

### Files to Delete

- (none)

## Implementation Notes

### Syntax Highlighting — Reuse Existing Infrastructure

The codebase already has a complete highlight.js setup:

- **`useSyntaxHighlight.ts`** (`packages/coc/src/server/spa/client/react/repos/useSyntaxHighlight.ts`): Imports `highlight.js/lib/core` with 15 selectively registered languages. Exports `getLanguageFromFileName()` (extension → hljs language map), `highlightLine()` (single-line highlighting), and `escapeHtml()`.
- **CDN fallback** in `html-template.ts`: highlight.js v11.9.0 loaded via CDN with `github.min.css` (light) / `github-dark.min.css` (dark) theme stylesheets, toggled by `ThemeProvider.tsx`.
- **Proven pattern**: `CommitFileContent.tsx` already renders file content with line numbers + per-line `highlightLine()` for source code, and `renderMarkdownToHtml()` + post-render `hljs.highlightElement()` for markdown. `PreviewPane` follows this pattern exactly.

No new npm dependencies, no new CDN scripts, no Prism.js — highlight.js is the established choice.

### Language Detection

`getLanguageFromFileName(fileName)` handles the extension-to-language mapping. The `EXT_TO_LANG` table covers `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.c`, `.h`, `.cpp`, `.cs`, `.json`, `.yaml`, `.yml`, `.sh`, `.css`, `.html`, `.xml`, `.svg`, `.md`. Files with unmapped extensions render as plain text (HTML-escaped, no highlighting).

### Binary File Handling

The blob API from commit 001 returns `{ content, encoding, mimeType }`:
- `encoding: 'utf-8'` → text content, render normally.
- `encoding: 'base64'` + `mimeType` starts with `image/` → render as `<img src="data:...">`.
- `encoding: 'base64'` + other MIME → show binary placeholder with file size.

### Size Limit

Client-side guard: if the blob response content exceeds 512 KB of text, truncate and show a banner. This prevents the browser from choking on extremely large files. The server blob endpoint (commit 002) already has a ~1 MB cap.

### Split Pane CSS

Follow the `RepoGitTab.tsx` responsive pattern:
- **Desktop (lg+):** Side-by-side flex layout — tree `w-[320px]` | preview `flex-1`.
- **Mobile/tablet:** Stack vertically or show only one pane at a time (tree or preview with a back button).
- Divider: `border-l border-gray-200 dark:border-gray-700` on the preview pane.

### Loading & Error States

Match `CommitFileContent.tsx` exactly:
- Loading: `<Spinner size="sm" />` centered with filename.
- Error: Error text + blue "Retry" button.
- Use `AbortController` to cancel in-flight fetches when the user clicks a different file before the previous one loads.

### File Header

Show a breadcrumb-style path header above the preview content: `src / components / App.tsx` with the filename segment bolded. Include a close button (×) that clears `previewFile` state.

## Tests

### Unit Tests — `PreviewPane.test.tsx`

| Test | Assertion |
|------|-----------|
| Renders loading spinner while fetch is pending | Spinner visible, no content |
| Renders source code with line numbers after fetch | Lines rendered, line numbers start at 1 |
| Applies syntax highlighting for known extensions | `highlightLine` called with correct language |
| Renders markdown as HTML for `.md` files | `markdown-body` class present, HTML rendered |
| Renders image for `image/*` MIME with base64 encoding | `<img>` tag with `data:` src |
| Shows binary placeholder for non-image base64 content | "Binary file" text visible, no code block |
| Shows "(empty file)" for empty content | Italic empty-file message visible |
| Truncates content exceeding 512 KB and shows banner | Banner text present, content truncated |
| Shows error state with Retry button on fetch failure | Error message + Retry button visible |
| Retry button re-triggers fetch | `fetchApi` called twice |
| Cancels in-flight request when filePath changes | AbortController.abort() called |
| Close button clears the preview | Preview pane replaced by placeholder text |

### Unit Tests — `ExplorerPanel` integration

| Test | Assertion |
|------|-----------|
| Double-clicking a file node opens PreviewPane | `PreviewPane` rendered with correct props |
| Pressing Enter on a focused file node opens PreviewPane | Same as above |
| Single-clicking a file does NOT open preview | `PreviewPane` not rendered |
| Selecting a different file replaces the preview | `PreviewPane` re-renders with new path |
| Placeholder shown when no file is selected | "Double-click a file to preview" text visible |

## Acceptance Criteria

- [ ] Double-clicking a file in the tree opens a syntax-highlighted preview in the right pane
- [ ] Pressing Enter on a focused file node opens the preview
- [ ] Source code files display with line numbers and per-line highlight.js highlighting
- [ ] Markdown files render as formatted HTML with highlighted code blocks
- [ ] Image files render inline as `<img>` elements
- [ ] Binary files show a descriptive placeholder instead of garbled content
- [ ] Empty files show an "(empty file)" message
- [ ] Files over 512 KB are truncated with a visible warning banner
- [ ] Loading spinner shows while the blob API request is in flight
- [ ] Network errors show an error message with a working Retry button
- [ ] Changing the selected file cancels any in-flight fetch and loads the new file
- [ ] Close button (×) dismisses the preview and restores the placeholder
- [ ] Light/dark theme toggle correctly switches highlight.js color scheme
- [ ] All unit tests pass

## Dependencies

- Depends on: 003 (`ExplorerPanel` split layout, `FileTree`, `TreeNode`, `onSelect` callback)
- Transitively depends on: 002 (`GET /api/repos/:repoId/blob` endpoint), 001 (`RepoTreeService.readBlob()`)

## Assumed Prior State

After commits 001-003, the following exist:

- **`RepoTreeService`** (001): `readBlob(repoId, path)` returns `{ content: string, encoding: 'utf-8' | 'base64', mimeType: string }`.
- **`GET /api/repos/:repoId/blob?path=...`** (002): HTTP endpoint that delegates to `RepoTreeService.readBlob()` and returns raw content with `Content-Type` header.
- **`<ExplorerPanel>`** (003): Top-level component with `<FileTree>` in left pane, and a **placeholder div** in the right pane showing "Double-click a file to preview". State: `expandedPaths`, `childrenMap`, `selectedPath`, `rootEntries`. No blob-fetching state yet — this commit adds it.
- **`<FileTree>`** (003): Recursive tree component. Supports expand/collapse, lazy loading, keyboard navigation (↑/↓/←/→/Enter). Calls `onSelect(path, isDirectory)` on click.
- **`<TreeNode>`** (003): Renders a single row (folder or file). Uses `TreeEntry` from `@plusplusoneplusplus/coc-server` with `{ name, type: 'file'|'dir', size?, path }`.
- **`useSyntaxHighlight.ts`** (pre-existing): `getLanguageFromFileName()`, `highlightLine()`, `escapeHtml()` — 15 registered highlight.js languages.
- **`markdown-renderer.ts`** (pre-existing): `renderMarkdownToHtml()` with frontmatter stripping, comment highlights, code block rendering.
- **`CommitFileContent.tsx`** (pre-existing): Reference implementation for file content rendering with syntax highlighting and markdown support.
