# Git Clone File Explorer — PRD

## Problem

When working with `coc serve` or deep-wiki workflows, users frequently clone remote repositories. Today there is **no way to browse the cloned repo's file tree** within the CoC dashboard. Users must leave the browser and open a terminal or editor to inspect the clone. This creates friction, especially for wiki generation and exploratory AI pipelines where understanding the repo structure is the first step.

## Proposed Solution

Add a **Miller-column file explorer** panel to the CoC dashboard that mirrors the UX of the existing Tasks Viewer tree in the VS Code extension. It renders the directory tree of a git-cloned repo as a collapsible, hierarchical tree with lazy-loaded children.

## Goals

| # | Goal |
|---|------|
| G1 | Let users browse any git-cloned repo's file tree from the CoC dashboard |
| G2 | Reuse the same tree-view patterns already proven in the Tasks panel |
| G3 | Keep the implementation lightweight — read-only, no editing |

## Non-Goals

- In-browser file editing or code review
- Git history / blame / diff within the explorer
- Replacing VS Code's native file explorer for local workspaces

## UX Design

### Layout

The file explorer appears as a **panel/tab** inside the CoC dashboard SPA (alongside Processes, Wiki, Memory, etc.). It is labelled **"Files"** or **"Explorer"**.

### Tree Interaction

| Element | Behavior |
|---------|----------|
| **Root node** | Repo name + short SHA of HEAD; always expanded |
| **Folder** | Collapsible. Click to expand/collapse. Shows folder icon. Children loaded lazily on first expand. |
| **File** | Leaf node. Single-click selects. Optional: double-click opens read-only preview pane (syntax-highlighted via `highlight.js` or `Prism`). |
| **Breadcrumb bar** | Shows current path segments. Each segment is clickable to scroll the tree. |
| **Search / filter** | Text input above the tree. Filters visible nodes by substring match (same as Tasks panel `FilterableTreeDataProvider` pattern). |

### Visual Style

- Indentation-based hierarchy (16px per level), with guide lines.
- File-type icons (folder, code, markdown, image, config, etc.) — use a small SVG icon set.
- Selected item highlighted; keyboard navigation (↑/↓/Enter/Backspace).

### Miller Column Variant (Stretch)

If screen width allows (≥ 1024 px), render as **true miller columns**: each folder click opens a new column to its right showing children, scrolling horizontally. On narrow screens, fall back to the standard indented tree.

## Technical Design

### Server Side — `coc-server`

#### New API Endpoints

```
GET  /api/repos                         → list cloned repos (name, path, HEAD sha)
GET  /api/repos/:repoId/tree?path=/     → list entries at path (name, type, size)
GET  /api/repos/:repoId/blob?path=/…    → raw file content (with size cap ~1 MB)
```

- **`repoId`** — slug derived from repo URL or local path (URL-safe base64 or short hash).
- **Tree endpoint** returns `{ entries: Array<{ name, type: 'file'|'dir', size? }> }`, sorted directories-first then alphabetically.
- **Blob endpoint** returns raw text (UTF-8) or base64 for binary; include `Content-Type` header.
- Repos are discovered from `~/.coc/` data directory (cloned by deep-wiki or pipelines) or a configurable `repos` list in `~/.coc/config.yaml`.

#### Implementation Notes

- Use Node.js `fs.readdir` with `withFileTypes: true` for tree listing — no git commands needed, just plain filesystem reads.
- Optionally use `git ls-tree` for performance on large repos (avoids reading ignored/build dirs).
- Respect `.gitignore` by default (toggle via query param `?showIgnored=true`).
- Add size guard: refuse to list directories with > 5 000 entries; paginate or return error.

### Client Side — SPA Dashboard

#### Component Hierarchy

```
<ExplorerPanel>
  <RepoSelector />          ← dropdown to pick which cloned repo
  <SearchBar />              ← filter input
  <FileTree>                 ← recursive tree component
    <TreeNode />             ← folder or file row
    <TreeNode />
      <TreeNode />           ← nested children (lazy)
  </FileTree>
  <PreviewPane />            ← optional: read-only file content
</ExplorerPanel>
```

#### State Management

- Tree state (expanded nodes, selected path) held in component-local state or a lightweight store.
- Lazy loading: children fetched on first expand via `/api/repos/:id/tree?path=…`.
- Cache fetched directories in memory to avoid re-fetching on collapse/expand.

#### Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move selection |
| `→` or `Enter` | Expand folder / open file preview |
| `←` or `Backspace` | Collapse folder / go to parent |
| `/` | Focus search bar |

### Integration Points

| Consumer | How it uses the explorer |
|----------|--------------------------|
| **Deep Wiki** | "Generate wiki for this folder" context-menu action |
| **Pipelines** | "Use as input" — pass selected file/folder path as `--param` |
| **Wiki Ask** | "Ask about this file" — pre-fills the wiki chat with file context |

## Data Model

```typescript
interface RepoInfo {
  id: string;           // URL-safe slug
  name: string;         // e.g. "facebook/react"
  localPath: string;    // absolute path on disk
  headSha: string;      // current HEAD commit
  clonedAt: string;     // ISO timestamp
}

interface TreeEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;        // bytes, files only
  path: string;         // relative to repo root
}
```

## Milestones

| Phase | Scope |
|-------|-------|
| **Phase 1 — Tree API** | Server endpoints (`/api/repos`, `/api/repos/:id/tree`). Unit tests. |
| **Phase 2 — Basic Tree UI** | `<FileTree>` component with expand/collapse, icons, keyboard nav. Wire to API. |
| **Phase 3 — File Preview** | Blob endpoint + `<PreviewPane>` with syntax highlighting. |
| **Phase 4 — Search & Filter** | Substring filter over visible tree nodes. |
| **Phase 5 — Integration** | Context-menu actions for deep-wiki, pipelines, wiki-ask. |
| **Phase 6 — Miller Columns** | Responsive miller-column layout for wide screens (stretch goal). |

## Open Questions

1. **Repo discovery** — Should repos be auto-discovered from `~/.coc/` or explicitly registered? Start with auto-discovery of deep-wiki clones + configurable extra paths.
2. **Large repos** — For monorepos (100k+ files), should we default to `git ls-tree` instead of `fs.readdir`? Likely yes for performance.
3. **Binary files** — Show a "binary file" placeholder or attempt to render images inline?
4. **Permissions** — Should blob reads require the same admin token as destructive ops, or are they open? Likely open (read-only).

## Success Criteria

- User can browse any cloned repo's full directory tree from the dashboard.
- Tree loads a 10 000-file repo's root in < 500 ms.
- Keyboard-only navigation works end-to-end.
- At least one integration point (deep-wiki or pipeline) is wired up.
