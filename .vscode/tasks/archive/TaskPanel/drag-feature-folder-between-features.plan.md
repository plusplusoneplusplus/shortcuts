# Drag Feature Folder Between Features

## Description

Allow users to drag and drop entire feature folders between different feature groups in the Task Panel tree view. This enables flexible reorganization of feature hierarchies without manually moving individual files or editing configuration by hand.

## Acceptance Criteria

- [x] Users can drag a feature folder from one parent feature to another via drag-and-drop in the Task Panel
- [x] All child items (tasks, subfolders, documents) move with the dragged folder
- [x] The underlying file system structure is updated to reflect the new hierarchy
- [x] The tree view refreshes correctly after the move
- [x] Moving a folder to the same parent (no-op) is handled gracefully
- [x] Dragging to an invalid drop target shows appropriate feedback (e.g., disallowed cursor)
- [x] Undo support or confirmation dialog before destructive moves
- [x] No data loss — all task documents and nested content are preserved after the move

## Subtasks

- [x] **Implement TreeDragAndDropController** — Register a `TreeDragAndDropController` for the Task Panel tree view to handle drag-and-drop of folder items
- [x] **Define drag MIME types** — Define custom MIME types for feature folder drag data
- [x] **Validate drop targets** — Implement logic to determine valid drop targets (other feature folders, root level) and reject invalid ones
- [x] **Move filesystem folder** — Implement the file system operation to move the folder and all its contents to the new location
- [ ] **Update configuration** — Update any references in `shortcuts.yaml` or task metadata that point to the moved folder's old path
- [x] **Refresh tree view** — Trigger a tree refresh after a successful move to reflect the new structure
- [x] **Handle edge cases** — Prevent moving a folder into its own subtree (circular move), handle name conflicts at the destination
- [x] **Add tests** — Write tests covering folder drag-and-drop, including valid moves, invalid targets, name conflicts, and nested folder preservation

## Notes

- The existing drag-and-drop infrastructure in `src/shortcuts/` (e.g., `drag-drop.test.ts`) can serve as a reference for implementation patterns.
- Consider using VS Code's `DataTransfer` API for the drag-and-drop controller.
- File watchers should automatically detect the filesystem changes; verify no duplicate refresh events occur.
- Cross-platform path handling is critical — use `path.join` / `vscode.Uri` consistently (see existing nested directory support in Tasks Viewer).
