---
status: pending
---

# 005: Search, Filter & Polish

## Summary

Add a `<SearchBar>` for substring-filtering the file tree and a `<Breadcrumbs>` path bar for spatial orientation, completing the explorer polish layer on top of the working tree + preview from commits 003–004.

## Motivation

Search/filter and breadcrumbs are pure UI polish — they depend on a fully functional tree and preview pane but don't change any data model or API surface. Splitting them into their own commit keeps 003 (tree + keyboard nav) and 004 (preview) focused on core mechanics, while this commit layers on discoverability features that make the explorer usable at scale (large repos with hundreds of visible nodes).

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/repos/explorer/SearchBar.tsx`

Search input with debounced filtering, matching the established SPA patterns.

```tsx
export interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    onClear: () => void;
    inputRef?: React.RefObject<HTMLInputElement>;
    placeholder?: string;         // default: "Filter files…"
}
```

**Implementation details:**

- Renders an `<input>` with a leading 🔍 icon and a trailing ✕ clear button (visible only when `value` is non-empty) — identical layout to `TasksPanel` search (lines 764–788 of `TasksPanel.tsx`).
- Tailwind classes match `ProcessFilters.tsx` input styling:
  ```
  w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white
  dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]
  focus:outline-none focus:border-[#0078d4]
  ```
  Plus `pl-7 pr-7` for icon padding (same as TasksPanel search input).
- The component is **controlled** — debounce logic lives in the parent (`ExplorerPanel`), not here. This mirrors how `ProcessFilters` keeps a local `searchInput` + debounce ref while dispatching `SET_SEARCH_QUERY` on timeout.
- `data-testid="explorer-search-input"` on the input, `data-testid="explorer-search-clear"` on the clear button.

#### `packages/coc/src/server/spa/client/react/repos/explorer/Breadcrumbs.tsx`

Clickable path breadcrumb bar showing the currently selected directory.

```tsx
export interface BreadcrumbsProps {
    /** Path segments from repo root to current directory, e.g. ["src", "server", "spa"] */
    segments: string[];
    /** Called when user clicks a segment; index 0 = root */
    onNavigate: (segmentIndex: number) => void;
    repoName?: string;            // shown as the root segment
    className?: string;
}
```

**Implementation details:**

- Renders a horizontal `<nav aria-label="Breadcrumb">` with `<ol>` containing `<li>` per segment.
- Each segment is a `<button>` with hover underline. Segments are separated by a `/` or `›` chevron span (use `›` to match VS Code breadcrumb UX).
- Root segment shows `repoName` (or "root" fallback) with a 📂 icon prefix.
- Last segment is rendered as plain `<span>` (not clickable, current location).
- Tailwind classes: `flex items-center gap-1 text-[10px] text-[#848484] truncate` — directly lifted from the `AddRepoDialog.tsx` breadcrumb pattern (line 248).
- Overflow: the entire bar uses `overflow-x-auto` with `scrollbar-hide` (or `overflow-hidden` with CSS `text-overflow: ellipsis` on a flex parent) so it doesn't wrap.
- `data-testid="explorer-breadcrumbs"` on the nav, `data-testid="breadcrumb-segment-{index}"` on each button.

### Files to Modify

#### `packages/coc/src/server/spa/client/react/repos/explorer/ExplorerPanel.tsx`

Integrate `<SearchBar>` and `<Breadcrumbs>` into the panel layout.

**State additions:**

```tsx
const [searchInput, setSearchInput] = useState('');
const [searchQuery, setSearchQuery] = useState('');
const debounceRef = useRef<ReturnType<typeof setTimeout>>();
const searchInputRef = useRef<HTMLInputElement>(null);
```

Debounce pattern (150 ms, matching `TasksPanel`):

```tsx
const onSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(value), 150);
}, []);

const onSearchClear = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
}, []);
```

**Keyboard shortcut** — register a `keydown` listener (same pattern as `TasksPanel` lines 109–125):

- `/` → `e.preventDefault(); searchInputRef.current?.focus()` (standard tree-search hotkey).
- `Escape` (when search is focused or has value) → clear search, blur input.

**Breadcrumb segments** — derived from `selectedPath`:

```tsx
const breadcrumbSegments = useMemo(() => {
    if (!selectedPath) return [];
    return selectedPath.split('/').filter(Boolean);
}, [selectedPath]);
```

`onNavigate(segmentIndex)` reconstructs the path from `segments.slice(0, segmentIndex + 1).join('/')` and calls the existing tree navigation (set `expandedPaths`, update `selectedPath`).

**Layout** — insert between `<RepoSelector>` and `<FileTree>`:

```tsx
<RepoSelector ... />
<Breadcrumbs
    segments={breadcrumbSegments}
    onNavigate={handleBreadcrumbNavigate}
    repoName={selectedRepo?.name}
/>
<SearchBar
    value={searchInput}
    onChange={onSearchChange}
    onClear={onSearchClear}
    inputRef={searchInputRef}
    placeholder="Filter files…"
/>
<FileTree
    ...
    filterQuery={searchQuery}
/>
<PreviewPane ... />
```

#### `packages/coc/src/server/spa/client/react/repos/explorer/FileTree.tsx`

Accept and apply the filter query.

**New prop:**

```tsx
interface FileTreeProps {
    // ... existing props from 003
    filterQuery?: string;
}
```

**Filtering logic** — apply substring match against `entry.name` for all *visible* (expanded) nodes. Follow the same `includes()` pattern used by `WikiComponentTree` (line 90) and `filterTaskItems` in `useTaskTree.ts` (line 149):

```tsx
const filteredEntries = useMemo(() => {
    if (!filterQuery) return entries;
    const q = filterQuery.toLowerCase();
    return entries.filter(entry => {
        // Always show directories that have matching descendants
        if (entry.type === 'dir') {
            return entry.name.toLowerCase().includes(q) || hasMatchingDescendant(entry, q);
        }
        return entry.name.toLowerCase().includes(q);
    });
}, [entries, filterQuery]);
```

`hasMatchingDescendant(entry, query)` walks already-cached children (from lazy-load cache) recursively. Directories whose children haven't been fetched yet are **kept visible** (benefit-of-the-doubt) so the user can expand them to search deeper.

**Match highlighting** — reuse the `highlightMatch()` function from `TaskSearchResults.tsx` (lines 11–24). Import it and apply to node labels:

```tsx
import { highlightMatch } from '../../tasks/TaskSearchResults';

// In TreeNode render:
<span className="truncate text-[#1e1e1e] dark:text-[#cccccc]">
    {filterQuery ? highlightMatch(entry.name, filterQuery) : entry.name}
</span>
```

**Auto-expand on filter** — when `filterQuery` transitions from empty to non-empty, auto-expand directories that contain matches (walk the cached tree, add their paths to `expandedPaths`). When `filterQuery` is cleared, restore the previous `expandedPaths` snapshot (save it on first filter activation).

### Files to Delete

- (none)

## Implementation Notes

### Debounce Timing

Use **150 ms** debounce on search input, matching `TasksPanel` (line 94). This is faster than `ProcessFilters` (200 ms) and `BranchPickerModal` (300 ms), justified because file-tree filtering is a pure client-side operation with no network round-trip.

### Filter Algorithm

1. **Client-side only** — filtering operates on the in-memory tree cache, never calls the API.
2. **Case-insensitive `String.includes()`** — same as `WikiComponentTree` (line 90) and `filterTaskItems` (line 149). No regex.
3. **Directory visibility rule**: a directory is shown if (a) its name matches, OR (b) any cached descendant matches. Un-fetched directories are always shown.
4. **Flat result mode is NOT used** — unlike `TaskSearchResults` which replaces the tree with a flat list, the file explorer keeps its tree structure intact and just hides non-matching branches. This preserves spatial context while filtering.

### Breadcrumb Segment Click Behavior

Clicking segment at index `i` does two things:
1. Sets `selectedPath` to the path formed by `segments.slice(0, i + 1).join('/')`.
2. Ensures that path is expanded in the tree (adds it to `expandedPaths` if not already present).

This navigates the tree focus and scrolls the corresponding `<TreeNode>` into view using `element.scrollIntoView({ block: 'nearest' })` — same pattern as `BranchPickerModal` (line 173).

### Keyboard Shortcut: `/` to Focus Search

Registered via a document-level `keydown` listener in `ExplorerPanel`. Only triggers when:
- No other input/textarea is focused (`document.activeElement?.tagName !== 'INPUT'`).
- The explorer panel is visible.

`Escape` clears the search and returns focus to the tree (the currently selected `<TreeNode>`).

### Tailwind / CSS Patterns

All classes are drawn from existing SPA components:

| Element | Source pattern | Classes |
|---------|---------------|---------|
| Search input container | `TasksPanel` line 764 | `relative flex items-center` |
| Search input | `ProcessFilters` line 54 | `w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]` |
| Search icon | `TasksPanel` line 765 | `absolute left-2 text-[#999] dark:text-[#888] pointer-events-none text-sm` |
| Clear button | `TasksPanel` line 779 | `absolute right-1.5 text-[#999] hover:text-[#333] dark:hover:text-[#eee] text-sm leading-none` |
| Breadcrumb bar | `AddRepoDialog` line 248 | `flex items-center gap-1 text-[10px] text-[#848484] truncate` |
| Breadcrumb segment button | `DAGBreadcrumb` line 46 | `text-[10px] text-[#848484] hover:text-[#0078d4] dark:hover:text-[#3794ff] hover:underline cursor-pointer bg-transparent border-none p-0` |
| Match highlight | `TaskSearchResults` line 17 | `<strong className="text-[#0078d4] dark:text-[#3794ff]">` |

## Tests

### Unit Tests — `packages/coc/src/server/spa/client/react/repos/explorer/__tests__/SearchBar.test.tsx`

- Renders input with placeholder "Filter files…".
- Calls `onChange` on user typing.
- Shows clear button only when value is non-empty.
- Calls `onClear` on clear button click.
- Forwards `inputRef` for programmatic focus.

### Unit Tests — `packages/coc/src/server/spa/client/react/repos/explorer/__tests__/Breadcrumbs.test.tsx`

- Renders repo name as root segment.
- Renders all segments with `›` separators.
- Last segment is not clickable.
- Calls `onNavigate(index)` when a segment button is clicked.
- Empty segments array renders only the root segment.

### Integration Tests — `packages/coc/src/server/spa/client/react/repos/explorer/__tests__/ExplorerPanel.search.test.tsx`

- Typing in search bar filters tree nodes after 150 ms debounce.
- Directories with matching children remain visible even if their own name doesn't match.
- Un-fetched directories remain visible during filtering.
- Clearing search restores original expanded state.
- Pressing `/` focuses the search input.
- Pressing `Escape` clears search and returns focus to tree.
- Clicking a breadcrumb segment navigates to that directory and expands it.
- Match highlighting renders `<strong>` around matched substring.

## Acceptance Criteria

- [ ] `<SearchBar>` renders with consistent styling (matches `ProcessFilters` / `TasksPanel` input patterns)
- [ ] Typing in search bar filters visible tree nodes by case-insensitive substring match within 150 ms
- [ ] Directories with matching cached descendants remain visible; un-fetched directories are never hidden
- [ ] Match text is highlighted in `<strong className="text-[#0078d4] dark:text-[#3794ff]">` (reusing `highlightMatch`)
- [ ] Clearing search (✕ button or Escape) restores the pre-filter expanded state
- [ ] Pressing `/` (when no input focused) moves focus to the search bar
- [ ] `<Breadcrumbs>` shows repo name as root + one button per path segment separated by `›`
- [ ] Clicking a breadcrumb segment navigates the tree to that directory and scrolls it into view
- [ ] Last breadcrumb segment is rendered as non-interactive text (current location)
- [ ] All new components have `data-testid` attributes for test targeting
- [ ] All Vitest tests pass (`npm run test:run` in `packages/coc/`)

## Dependencies

- Depends on: 003 (`ExplorerPanel`, `FileTree`, `TreeNode`, keyboard nav, lazy-load, expanded state)
- Depends on: 004 (`PreviewPane` — layout integration only; search/filter don't affect preview)

## Assumed Prior State

From **001–002** (API layer):
- `GET /api/repos/:id/tree?path=` returns `{ entries: TreeEntry[], truncated: boolean }` with `name`, `type` (`'file'|'dir'`), `size?`, `path`.
- `GET /api/repos/:id/blob?path=` returns file content.

From **003** (tree UI):
- `<ExplorerPanel>` orchestrates `<FileTree>`, state for `expandedPaths: Set<string>`, `childrenMap: Map<string, TreeEntry[]>`, `selectedPath: string`.
- `<FileTree>` renders `<TreeNode>` recursively with lazy-load on expand.
- `<TreeNode>` supports keyboard navigation (↑/↓/→/←/Enter) and file-type icons.
- Children are cached in `childrenMap` after first fetch.

From **004** (preview):
- `<PreviewPane>` renders syntax-highlighted file content for the selected file.
- Integrated into `<ExplorerPanel>` layout to the right of the tree.
