---
status: done
---

# Support Drag-and-Drop to Move Files and Folders in Tasks Tab

## Problem

The Tasks tab in the CoC SPA dashboard only supports moving files and folders via modal dialogs (`FolderMoveDialog`, `FileMoveDialog`). Users must right-click → "Move" → pick destination from a list. This is slow and unintuitive — drag-and-drop is the expected interaction for spatial reorganization in a file-tree UI.

## Current State

| Component | File | Role |
|-----------|------|------|
| `TaskTree.tsx` | `packages/coc/src/server/spa/client/react/TaskTree.tsx` | Miller-columns layout; renders columns of `TaskTreeItem` |
| `TaskTreeItem.tsx` | `packages/coc/src/server/spa/client/react/TaskTreeItem.tsx` | Individual row (`<li>`) for folder/file |
| `TasksPanel.tsx` | `packages/coc/src/server/spa/client/react/TasksPanel.tsx` | Top-level orchestrator; manages dialogs + callbacks |
| `useFileActions.ts` | `packages/coc/src/server/spa/client/react/hooks/useFileActions.ts` | `moveFile(sourcePath, destFolder)` → `POST /tasks/move` |
| `useFolderActions.ts` | `packages/coc/src/server/spa/client/react/hooks/useFolderActions.ts` | `moveFolder(sourcePath, destFolder)` → `POST /tasks/move` |
| `task-operations.ts` | `packages/pipeline-core/src/tasks/task-operations.ts` | Backend: `moveTask()`, `moveFolder()` with collision + circular-move handling |
| `tasks-handler.ts` | `packages/coc/src/server/tasks-handler.ts` | `POST /workspaces/:id/tasks/move` endpoint |

**Key insight:** The backend move API and frontend hooks already exist and are fully functional. This feature is purely a UI/interaction layer addition.

## Approach

Add HTML5 native drag-and-drop to `TaskTreeItem` and `TaskTree` components. No third-party DnD libraries — keep it consistent with the rest of the codebase which uses native APIs.

### Design Decisions

1. **Drag source:** Any file or folder row in the Miller-columns tree. Multi-selected files can be dragged together.
2. **Drop target:** Folder rows and column empty-space (drops into that column's parent folder). The Tasks root is also a valid drop target.
3. **Visual feedback:** Highlighted border/background on valid drop targets during drag-over; dimmed drag ghost; "no-drop" cursor on invalid targets.
4. **Validation (client-side):**
   - Cannot drop a folder into itself or any descendant (circular move)
   - Cannot drop an item into its current parent (no-op)
   - Cannot drop into archive (use archive action instead)
5. **API reuse:** Drop handler calls existing `moveFile()` / `moveFolder()` hooks — no new endpoints needed.
6. **Multi-select drag:** If dragging a file that is part of a multi-selection, all selected files move together (bulk move).

## Affected Files

### Layer 1 — DnD Hook + Types

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/hooks/useTaskDragDrop.ts` | **New.** Custom hook encapsulating all DnD state: `draggedItems`, `dropTarget`, drag/drop event handlers, validation logic |
| `packages/coc/src/server/spa/client/react/types.ts` (or inline) | Add `DragItem` type: `{ path: string; type: 'file' \| 'folder'; name: string }` |

### Layer 2 — TaskTreeItem (Drag Source + Drop Target)

| File | Change |
|------|--------|
| `TaskTreeItem.tsx` | Add `draggable` attribute on `<li>`; wire `onDragStart`, `onDragEnd`, `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` handlers; add CSS classes for drag/drop states |

### Layer 3 — TaskTree (Column Drop Zones)

| File | Change |
|------|--------|
| `TaskTree.tsx` | Add `onDragOver` + `onDrop` on column `<div>`s (for dropping into empty space = move to that column's folder); pass DnD callbacks to `TaskTreeItem` |

### Layer 4 — TasksPanel (Orchestration)

| File | Change |
|------|--------|
| `TasksPanel.tsx` | Wire DnD hook; handle drop completion → call `moveFile`/`moveFolder` → refresh tree; handle multi-select bulk moves |

### Layer 5 — CSS

| File | Change |
|------|--------|
| SPA CSS (inline or stylesheet) | `.drop-target-active` (highlight border/bg on valid folder), `.dragging` (opacity reduction on source), `.drop-invalid` (no-drop cursor) |

### Layer 6 — Tests

| File | Change |
|------|--------|
| `packages/coc/test/spa/react/useTaskDragDrop.test.ts` | **New.** Test validation logic: circular move detection, same-parent no-op, archive exclusion |
| `packages/coc/test/spa/react/TaskTreeItem.dragdrop.test.tsx` | **New.** Test drag start sets correct data, drop on folder triggers move, visual states |

## Todos

### 1. Create `useTaskDragDrop` hook with types and validation
- **Files:** New `useTaskDragDrop.ts` hook
- Define `DragItem` type (`path`, `type`, `name`)
- Implement `canDrop(source: DragItem, targetFolderPath: string): boolean` — checks circular moves, same-parent, archive
- Manage state: `draggedItems: DragItem[]`, `dropTargetPath: string | null`, `isDragging: boolean`
- Export drag event handler factories: `createDragStartHandler`, `createDropHandler`, `createDragOverHandler`
- Use `DataTransfer` API with MIME type `application/x-task-drag` for internal data

### 2. Make `TaskTreeItem` a drag source
- Add `draggable={true}` to `<li>` element
- `onDragStart`: serialize `DragItem` into `DataTransfer`; set drag image; if item is multi-selected, include all selected paths
- `onDragEnd`: clear drag state
- Add `.dragging` CSS class during drag (reduce opacity)
- Prevent drag on checkbox click (don't interfere with selection)

### 3. Make folders drop targets with visual feedback
- On folder `<li>`: wire `onDragOver` (preventDefault to allow drop + validate), `onDragEnter`/`onDragLeave` (toggle highlight), `onDrop` (execute move)
- Add `.drop-target-active` CSS: subtle border or background highlight on valid hover
- Show "no-drop" cursor via `dropEffect = 'none'` when `canDrop()` returns false
- On column empty-space `<div>`: wire same handlers, target = column's parent folder path

### 4. Wire drop to move API and handle refresh
- `onDrop` handler: determine if source is file or folder → call `moveFile()` or `moveFolder()` from existing hooks
- For multi-select: iterate `moveFile()` for each selected path (sequential to avoid race conditions)
- After move: tree auto-refreshes via WebSocket `tasks-changed` event (already wired)
- Error handling: show toast/notification on move failure (e.g., collision, permission error)

### 5. Add tests for DnD hook and validation
- Test `canDrop()`: circular folder move → false, same parent → false, archive target → false, valid move → true
- Test drag data serialization and deserialization
- Test multi-select drag: all selected items included in drag data
- Component test: simulate drag events on `TaskTreeItem`, verify CSS classes and callbacks

## Open Questions

- **Cross-workspace drag?** Current dialogs support "Move To Other Repo". Drag-and-drop across repo panels would require cross-widget DnD coordination — recommend deferring to a follow-up.
- **Reorder within folder?** Files are sorted by name/status. Drag-drop reorder within the same folder would require a custom sort order. Recommend deferring — keep this scoped to moving between folders only.
- **Drag to archive folder?** Could enable "drag to archive" as a shortcut for archiving. Recommend including if the archive folder is visible in the tree.
