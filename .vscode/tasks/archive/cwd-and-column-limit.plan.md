# Plan: Show CWD & Limit Miller Column Levels in Tasks Tab

## Problem

The CoC Tasks tab uses a miller-column layout. When a user navigates deep into a folder hierarchy, there is no visual indicator of **where the current selection lives** (CWD), and all columns are rendered at once, making deep hierarchies feel cluttered. The user wants:

1. **CWD display** – show the path of the currently selected folder/file so they can orient themselves.
2. **Sliding-window column limit** – cap the number of visible miller columns (default: 2). When the user drills into level 3, only the last 2 columns are shown (sliding window), keeping the UI compact.

---

## Relevant Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/tasks/TaskTree.tsx` | Miller column state (`columns[]`), column rendering loop, click handlers |
| `packages/coc/src/server/spa/client/react/tasks/TaskActions.tsx` | Toolbar above columns (Copy path, Open in editor, etc.) |
| `packages/coc/src/server/spa/client/react/tasks/TaskContext.tsx` | Shared state: `selectedFolderPath`, `openFilePath` |
| `packages/coc/test/spa/react/task-tree.test.tsx` | Unit tests for column rendering |

---

## Approach

### 1. CWD Display in Toolbar (`TaskActions.tsx`)

Add a styled CWD breadcrumb/path line **below (or inline with) the existing action buttons**, using `selectedFolderPath` from context.

- If `selectedFolderPath` is set, render the path as a truncated, monospace string (e.g., `~/projects/shortcuts/.vscode/tasks/coc/tasks`).
- Truncate long paths with a leading `…` so the rightmost (most specific) segments are always visible.
- Use a muted color (`text-[#848484]`) and small font (`text-xs`) so it does not compete with action buttons.
- Clicking the CWD text copies it to clipboard (reuse the existing `handleCopyPath` pattern).

**No new context state needed** – `selectedFolderPath` already exists.

### 2. Sliding-Window Column Limit (`TaskTree.tsx`)

**Goal:** at most `MAX_VISIBLE_COLUMNS` (default **2**) columns rendered at once. When more columns exist, the window slides to show the **last** N columns.

#### State / constants

```ts
const MAX_VISIBLE_COLUMNS = 2;
```

#### Derive visible slice

```ts
const visibleStartIndex = Math.max(0, columns.length - MAX_VISIBLE_COLUMNS);
const visibleColumns = columns.slice(visibleStartIndex);
```

#### Adjust column-index passed to handlers

The existing handlers (`handleFolderClick`, `handleFileClick`, drag-and-drop) receive `colIndex` which is the **absolute** index into `columns`. The render loop currently passes the loop index directly. After slicing, the rendered `colIndex` will be a **relative** index (0…N-1). Fix by adding back `visibleStartIndex`:

```tsx
{visibleColumns.map((colNodes, relIndex) => {
    const colIndex = visibleStartIndex + relIndex;
    // ... rest of existing rendering, unchanged
})}
```

No other logic changes are needed because `handleFolderClick` already does:
```ts
setColumns(prev => [...prev.slice(0, colIndex + 1), children]);
```
This correctly trims deeper columns using the absolute index.

#### Left-edge visual cue

When `visibleStartIndex > 0`, show a subtle indicator at the left edge of the column area to signal that hidden ancestor columns exist (e.g., a left-overflow shadow or a small "‹ N more" label that, when clicked, shifts the window left by one).

- **Optional / stretch goal**: a `visibleStartIndex` state override so the user can manually scroll the window left.

---

## Tasks

1. **CWD display in TaskActions**
   - In `TaskActions.tsx`, read `selectedFolderPath` from context (already available via props).
   - Render a `<div>` below the button row with the truncated path.
   - Add a `title` attribute for the full untruncated path (tooltip on hover).
   - Unit test: verify CWD element renders when `selectedFolderPath` is set; hidden when null.

2. **Sliding-window column slice in TaskTree**
   - Define `MAX_VISIBLE_COLUMNS = 2` constant near the top of `TaskTree.tsx`.
   - Compute `visibleStartIndex` and `visibleColumns` from `columns` state.
   - Update the render loop to use `visibleColumns` and pass `colIndex = visibleStartIndex + relIndex` to handlers and `TaskTreeItem`.
   - Unit test: with 3 columns populated, assert only 2 `miller-column-*` elements exist in the DOM (columns 1 and 2, not 0).

3. **Left-overflow indicator**
   - When `visibleStartIndex > 0`, render a visual cue (e.g., a left-fade shadow or `‹ coc / tasks` breadcrumb segment) at the left edge of the miller area.
   - Unit test: indicator present when `visibleStartIndex > 0`, absent otherwise.

---

## Out of Scope

- Changing the column **width**.
- Persisting `MAX_VISIBLE_COLUMNS` as a user preference (can be a follow-up).
- Changing the right-side preview panel.
