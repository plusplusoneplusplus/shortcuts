---
status: pending
---

# 003: FileTree SPA Component & Panel Wiring

## Summary

Add an `ExplorerPanel` (with `FileTree` and `TreeNode` sub-components) to the Repos view as a new `explorer` sub-tab, enabling lazy-loaded directory browsing and blob viewing for any registered repo via the tree/blob API endpoints from commit 002.

## Motivation

Separating the UI layer from the API layer (commit 002) keeps the diff small, allows the React components to be reviewed and tested independently, and makes the rendering logic reusable — the same tree components could later power pipeline file pickers or wiki source browsing.

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/repos/explorer/ExplorerPanel.tsx`

Top-level panel rendered when `activeRepoSubTab === 'explorer'`. Follows the same left/right split pattern as `RepoGitTab.tsx`:

```tsx
interface ExplorerPanelProps {
    workspaceId: string;
}
```

- **Layout:** `<div className="flex flex-col lg:flex-row h-full overflow-hidden">` — mirrors `RepoGitTab`'s responsive split. Left `<aside>` (320 px on lg, full width on mobile) holds the `FileTree`; right `<main>` has a placeholder div for the preview pane (wired in commit 004).
- **State shape:**
  ```ts
  const [rootEntries, setRootEntries] = useState<TreeEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Map<string, TreeEntry[]>>(new Map());
  ```
- **Initial fetch:** On mount, calls `fetchApi(\`/api/repos/${encodeURIComponent(workspaceId)}/tree?path=/\`)` to populate `rootEntries`.
- **Right pane placeholder:** Shows "Double-click a file to preview" message (commit 004 replaces with `<PreviewPane>`).
- **Deep-link:** Updates `location.hash` to `#repos/${repoId}/explorer/${encodeURIComponent(path)}` on file selection. On mount, reads hash to restore path.
- **Loading/error:** Uses `<Spinner size="lg" />` centered div pattern from `RepoGitTab`.

#### `packages/coc/src/server/spa/client/react/repos/explorer/FileTree.tsx`

Recursive, lazy-loaded tree sidebar rendered inside `ExplorerPanel`'s left aside.

```tsx
interface FileTreeProps {
    workspaceId: string;
    entries: TreeEntry[];
    selectedPath: string | null;
    expandedPaths: Set<string>;
    childrenMap: Map<string, TreeEntry[]>;
    onSelect: (path: string, isDirectory: boolean) => void;
    onToggle: (path: string) => void;
    onChildrenLoaded: (parentPath: string, children: TreeEntry[]) => void;
}
```

- **Rendering:** `<div className="flex flex-col h-full text-sm">` wrapping a scrollable list (same structure as `WikiComponentTree.tsx`). Note: the search/filter input is NOT included here — it is added in commit 005.
- **Tree list:** `<div className="flex-1 overflow-y-auto">` containing a flat list of `<TreeNode>` components. Root entries are at indent level 0.

#### `packages/coc/src/server/spa/client/react/repos/explorer/TreeNode.tsx`

Single row in the file tree. Handles expand/collapse for directories and click-to-select for files.

```tsx
// Re-exported from coc-server/src/repos/types.ts — no local re-declaration needed
import type { TreeEntry } from '@plusplusoneplusplus/coc-server';

interface TreeNodeProps {
    entry: TreeEntry;
    depth: number;       // indentation level (0 = root)
    workspaceId: string;
    selectedPath: string | null;
    expandedPaths: Set<string>;
    childrenMap: Map<string, TreeEntry[]>;
    onToggle: (path: string) => void;
    onSelect: (path: string, isDirectory: boolean) => void;
    onChildrenLoaded: (parentPath: string, children: TreeEntry[]) => void;
}
```

- **Row styling** (matches `TaskTreeItem.tsx` and `WikiComponentTree` patterns):
  ```tsx
  <div
      className={cn(
          'flex items-center gap-1.5 px-3 py-1 cursor-pointer text-xs transition-colors',
          'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
          selectedPath === entry.path && 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10 text-[#0078d4] dark:text-[#3794ff]',
      )}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      data-testid={`tree-node-${entry.path}`}
  >
  ```
- **Expand/collapse chevron** for directories: `<span className={cn('text-[10px] transition-transform', isExpanded && 'rotate-90')}>▶</span>` — same pattern as WikiComponentTree group headers.
- **File-type icons:** Emoji-based, matching TaskTreeItem convention:
  - Directory: `📁`
  - `.md`/`.markdown`/`.mdx`: `📝`
  - `.ts`/`.tsx`/`.js`/`.jsx`: `📄`
  - `.json`/`.yaml`/`.yml`: `⚙️`
  - Images (`.png`/`.jpg`/`.svg`/`.gif`): `🖼️`
  - Default: `📄`
- **Lazy loading on expand:** When a directory node is expanded and `childrenMap` has no entry for its path, fetch `fetchApi(\`/api/repos/${encodeURIComponent(workspaceId)}/tree?path=${encodeURIComponent(entry.path)}\`)`, then call `onChildrenLoaded(entry.path, data.entries)`. Show `<Spinner size="sm" />` inline while loading.
- **Children rendering:** If expanded and children are loaded, render each child as a `<TreeNode depth={depth + 1} .../>` recursively.
- **Keyboard navigation:** The parent `FileTree` attaches an `onKeyDown` handler to the scrollable container:
  - `ArrowDown` / `ArrowUp`: Move focus to next/previous visible node (tracked via a `focusedIndex` state + `data-tree-index` attributes).
  - `ArrowRight`: If focused node is a collapsed directory, expand it. If already expanded or a file, no-op.
  - `ArrowLeft`: If focused node is an expanded directory, collapse it. If collapsed or a file, move focus to parent.
  - `Enter` / `Space`: Select the focused node (trigger `onSelect`).
  - Apply `tabIndex={0}` to the scrollable container and use `scrollIntoView({ block: 'nearest' })` on the focused element after each arrow key.

### Files to Modify

#### `packages/coc/src/server/spa/client/react/types/dashboard.ts` (line 6)

Add `'explorer'` to the `RepoSubTab` union:

```ts
// Before:
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki' | 'copilot' | 'workflow';

// After:
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki' | 'copilot' | 'workflow' | 'explorer';
```

#### `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

1. **Import ExplorerPanel** (after the `RepoCopilotTab` import, ~line 19):
   ```ts
   import { ExplorerPanel } from './ExplorerPanel';
   ```

2. **Add to `SUB_TABS` array** (line 39–48). Insert before the closing `]`, after `copilot`:
   ```ts
   { key: 'explorer', label: 'Explorer' },
   ```

3. **Add rendering case** in the sub-tab content switch block (~line 486, after the `workflow` case):
   ```tsx
   {activeSubTab === 'explorer' && <ExplorerPanel workspaceId={ws.id} />}
   ```

#### `packages/coc/src/server/spa/client/react/layout/Router.tsx`

1. **Add `'explorer'` to `VALID_REPO_SUB_TABS`** (line 155):
   ```ts
   export const VALID_REPO_SUB_TABS: Set<string> = new Set([
       'info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat', 'wiki', 'copilot', 'workflow', 'explorer'
   ]);
   ```

2. **Add deep-link parsing** for `#repos/:id/explorer/:path` in the hash-change handler (~line 274, after the `workflow` block):
   ```ts
   if (parts[2] === 'explorer' && parts[3]) {
       dispatch({ type: 'SET_EXPLORER_PATH', path: decodeURIComponent(parts.slice(3).join('/')) });
   } else if (parts[2] === 'explorer') {
       dispatch({ type: 'SET_EXPLORER_PATH', path: null });
   }
   ```

#### `packages/coc/src/server/spa/client/react/context/AppContext.tsx` (reducer)

Add state field and reducer actions for the explorer deep-link:

```ts
// State addition:
selectedExplorerPath: string | null;   // default: null

// Reducer cases:
case 'SET_EXPLORER_PATH':
    return { ...state, selectedExplorerPath: action.path };
```

### Files to Delete

- (none)

## Implementation Notes

### Component hierarchy

```
ExplorerPanel
├── FileTree (left aside)
│   └── <div> scrollable container (onKeyDown for keyboard nav)
│       ├── TreeNode (depth 0)
│       │   ├── TreeNode (depth 1, lazy loaded)
│       │   └── ...
│       └── ...
└── Placeholder div (right main) — "Double-click a file to preview" (replaced by PreviewPane in commit 004)
```

### Lazy loading flow

1. `ExplorerPanel` mounts → fetches `/api/repos/:id/tree?path=/` → stores result as `rootEntries`.
2. User clicks a directory `TreeNode` → `onToggle(path)` adds path to `expandedPaths: Set<string>`.
3. `TreeNode` sees it's expanded but `childrenMap.get(path)` is undefined → fetches `/api/repos/:id/tree?path=<dir>` → calls `onChildrenLoaded(path, entries)` which sets `childrenMap` via `setChildrenMap(prev => new Map(prev).set(path, entries))`.
4. Subsequent expand/collapse of the same directory is instant (children cached in `childrenMap`).
5. A "Refresh" button in `ExplorerPanel` header clears `childrenMap` and re-fetches root.

### State management

All tree state (`expandedPaths`, `childrenMap`, `selectedPath`, `focusedIndex`) lives in `ExplorerPanel` as local React state. No global context changes needed beyond the deep-link `selectedExplorerPath`. This follows the same pattern as `RepoGitTab` which manages its own `commits`, `rightPanelView`, etc. locally.

### Tailwind class patterns

- Borders: `border-[#e0e0e0] dark:border-[#3c3c3c]`
- Backgrounds: `bg-[#f3f3f3] dark:bg-[#252526]` (sidebar), `bg-white dark:bg-[#1e1e1e]` (main)
- Text: `text-[#1e1e1e] dark:text-[#cccccc]` (primary), `text-[#848484]` (muted), `text-[#0078d4] dark:text-[#3794ff]` (accent/active)
- Hover: `hover:bg-black/[0.04] dark:hover:bg-white/[0.04]`
- Active selection: `bg-[#0078d4]/10 dark:bg-[#3794ff]/10`
- Focus ring: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4]`

### Keyboard navigation implementation

`FileTree` maintains a `focusedIndex: number` state (default -1). On each render, visible nodes are flattened into an ordered list. The scrollable container has `tabIndex={0}` and an `onKeyDown` handler:

```tsx
const handleKeyDown = (e: React.KeyboardEvent) => {
    const visibleNodes = flattenVisibleNodes(rootEntries, expandedPaths, childrenMap);
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            setFocusedIndex(i => Math.min(i + 1, visibleNodes.length - 1));
            break;
        case 'ArrowUp':
            e.preventDefault();
            setFocusedIndex(i => Math.max(i - 1, 0));
            break;
        case 'ArrowRight': {
            const node = visibleNodes[focusedIndex];
            if (node?.type === 'dir' && !expandedPaths.has(node.path)) {
                onToggle(node.path);
            }
            break;
        }
        case 'ArrowLeft': {
            const node = visibleNodes[focusedIndex];
            if (node?.type === 'dir' && expandedPaths.has(node.path)) {
                onToggle(node.path);
            }
            break;
        }
        case 'Enter':
        case ' ':
            e.preventDefault();
            const node = visibleNodes[focusedIndex];
            if (node) onSelect(node.path, node.type === 'dir');
            break;
    }
};
```

The focused `TreeNode` receives an `isFocused` prop and applies `ring-1 ring-[#0078d4]/50 dark:ring-[#3794ff]/50` plus `scrollIntoView({ block: 'nearest' })` via a ref callback.

## Tests

### Unit tests (`packages/coc/src/server/spa/client/react/repos/explorer/__tests__/`)

These are Vitest tests using `@testing-library/react` (consistent with existing SPA test setup).

1. **`FileTree.test.tsx`** — Renders root entries, calls `onSelect` on click, calls `onToggle` on directory click.
2. **`TreeNode.test.tsx`** — Renders file/directory icons correctly, shows chevron for directories, calls `onToggle` on directory click, shows `Spinner` while children loading (childrenMap has no entry and node is expanded).
3. **`ExplorerPanel.test.tsx`** — Mocks `fetchApi`, verifies root entries loaded on mount, loading/error states render correctly, placeholder shown in right pane.
4. **`FileTree-keyboard.test.tsx`** — Arrow key navigation moves `focusedIndex`, Enter triggers selection, ArrowRight expands directory, ArrowLeft collapses directory.

### What cannot be easily unit-tested

- Deep-link round-tripping with `location.hash` (better suited for e2e/integration).
- Actual API integration with `RepoTreeService` (covered by 002 API tests).

## Acceptance Criteria

- [ ] New "Explorer" sub-tab appears in `RepoDetail` tab bar between "Copilot" and the end.
- [ ] Clicking "Explorer" renders `ExplorerPanel` which fetches and displays root directory entries.
- [ ] Clicking a directory expands it inline, fetching children lazily from `/api/repos/:id/tree?path=<dir>`.
- [ ] Clicking a file highlights it; right pane shows placeholder (preview wired in commit 004).
- [ ] Previously expanded directories remain expanded without re-fetching (in-memory cache via `childrenMap`).
- [ ] Keyboard navigation (Arrow keys, Enter) works for traversing and selecting nodes.
- [ ] Deep-link `#repos/:id/explorer/:path` restores the selected file on page load.
- [ ] `RepoSubTab` type includes `'explorer'`; `VALID_REPO_SUB_TABS` includes `'explorer'`; Router parses the hash.
- [ ] All new components have `data-testid` attributes for test selectors.
- [ ] Vitest unit tests pass for `FileTree`, `TreeNode`, `ExplorerPanel`, and keyboard navigation.

## Dependencies

- Depends on: 002 (API endpoints for `/api/repos/:id/tree` and `/api/repos/:id/blob`)

## Assumed Prior State

After commits 001 + 002, the following are available:
- **`RepoTreeService`** with `listRepos(): Promise<RepoInfo[]>`, `resolveRepo(repoId): RepoInfo | undefined`, `listDirectory(repoId, relativePath): Promise<TreeListResult>`, `readBlob(repoId, relativePath): Promise<{content, encoding, mimeType}>`.
- **`RepoInfo`** with `{ id, name, localPath, headSha, clonedAt, remoteUrl? }`.
- **`TreeEntry`** with `{ name, type: 'file'|'dir', size?, path }`.
- **`GET /api/repos`** → `RepoInfo[]`.
- **`GET /api/repos/:repoId/tree?path=...`** → `{ entries: TreeEntry[], truncated: boolean }`.
- **`GET /api/repos/:repoId/blob?path=...`** → raw file content with `Content-Type` header.
