# Plan: Reveal Task in Panel from Search Results

## Problem

When a user searches for a task in the Tasks tab, results appear as a flat list
(`TaskSearchResults`). There is currently no way to navigate from a search result
to its location in the miller-column panel (i.e. reveal the file in its folder
hierarchy). The user's ask: right-clicking a search result file should offer a
"Reveal in Panel" (or "Go to Panel") context-menu action.

## Proposed Approach

Three small, surgical changes:

1. **`TaskSearchResults.tsx`** — add `onContextMenu` prop so each `<li>` fires a
   callback `(item, clientX, clientY)` on right-click.

2. **`TasksPanel.tsx`** — wire up the context menu:
   - Pass `handleFileContextMenu` to `TaskSearchResults` as `onContextMenu`.
   - Add a **"Reveal in Panel"** menu item at the top of `fileMenuItems` that:
     a. Closes the context menu.
     b. Clears the search query (sets `searchInput` + `searchQuery` to `''`).
     c. Sets a new `navigateToFilePath` state to the file's relative path.

3. **`TaskTree.tsx`** — add `navigateToFilePath?: string | null` prop with a
   `useEffect` that, whenever the prop changes to a non-null value, rebuilds the
   miller columns to reveal the file (mirrors the existing `initialFilePath`
   initialization logic).

## Detailed Steps

### Step 1 — `TaskSearchResults.tsx`

Add prop to the `TaskSearchResultsProps` interface:

```ts
onContextMenu?: (item: TaskDocument | TaskDocumentGroup, x: number, y: number) => void;
```

Add handler to each `<li>`:

```tsx
onContextMenu={(e) => {
  e.preventDefault();
  onContextMenu?.(item, e.clientX, e.clientY);
}}
```

### Step 2 — `TasksPanel.tsx`

**New state** (near other navigation state):

```ts
const [navigateToFilePath, setNavigateToFilePath] = useState<string | null>(null);
```

**"Reveal in Panel" menu item** — prepend to `fileMenuItems` array (inside the
IIFE that builds it):

```ts
{
  label: 'Reveal in Panel',
  icon: '🔍',
  onClick: () => {
    setFileCtxMenu(null);
    onSearchClear();                         // clears searchInput + searchQuery
    if (fileCtxMenu?.ctxItem.paths[0]) {
      setNavigateToFilePath(fileCtxMenu.ctxItem.paths[0]);
    }
  },
},
{ separator: true, label: '', onClick: noop },
```

**Pass props to `TaskSearchResults`**:

```tsx
<TaskSearchResults
  ...existing props...
  onContextMenu={handleFileContextMenu}
/>
```

**Pass `navigateToFilePath` to `TaskTree`**:

```tsx
<TaskTree
  ...existing props...
  navigateToFilePath={navigateToFilePath}
  onNavigated={() => setNavigateToFilePath(null)}
/>
```

### Step 3 — `TaskTree.tsx`

**Add props**:

```ts
interface TaskTreeProps {
  ...
  navigateToFilePath?: string | null;
  onNavigated?: () => void;
}
```

**New `useEffect`** (after the existing initialization effect):

```ts
useEffect(() => {
  if (!navigateToFilePath || !tree) return;

  const folderPath = navigateToFilePath.includes('/')
    ? navigateToFilePath.split('/').slice(0, -1).join('/')
    : '';
  const segments = folderPath.split('/').filter(Boolean);
  const rootNodes = folderToNodes(tree);
  const cols: TaskNode[][] = [rootNodes];
  const keys: (string | null)[] = [];
  let cur = tree;
  for (const seg of segments) {
    const found = cur.children.find(f => f.name === seg);
    if (!found) break;
    cols.push(folderToNodes(found));
    keys.push(getFolderKey(found));
    cur = found;
  }
  setColumns(cols);
  setActiveFolderKeys(keys);
  activeFolderKeysRef.current = keys;
  setOpenFilePath(navigateToFilePath);
  setSelectedFolderPath(folderPath || null);
  const encoded = navigateToFilePath.split('/').map(encodeURIComponent).join('/');
  history.replaceState(null, '', `#repos/${encodeURIComponent(wsId)}/tasks/${encoded}`);
  onNavigated?.();
}, [navigateToFilePath, tree]);
```

## Files Affected

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/tasks/TaskSearchResults.tsx` | Add `onContextMenu` prop + `onContextMenu` on `<li>` |
| `packages/coc/src/server/spa/client/react/tasks/TasksPanel.tsx` | New `navigateToFilePath` state, "Reveal in Panel" menu item, pass props to children |
| `packages/coc/src/server/spa/client/react/tasks/TaskTree.tsx` | New `navigateToFilePath` + `onNavigated` props, navigation effect |

## Out of Scope

- No new tests are required beyond spot-checking the existing Vitest suite.
- The right-click menu for search results will reuse the **same** `ContextMenu`
  component and `fileMenuItems` array already used by `TaskTree` items.
- The "Reveal in Panel" item only appears in the menu when triggered from search
  results; for `TaskTree` items the same menu is used but the item is still shown
  (navigating to a file you're already viewing is harmless).
