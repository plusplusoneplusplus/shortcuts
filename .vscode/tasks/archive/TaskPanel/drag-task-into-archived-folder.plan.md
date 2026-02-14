# Drag task file into archived folder

## Description
Enable dragging a task markdown file in the Tasks panel and dropping it onto the **Archived** folder to archive it.

Today, tasks can be organized and moved via the tree, but archiving should be a first-class drag-and-drop action: when a user drags a task file and drops it onto the Archived folder node, the extension should move the underlying file into the archive folder (preserving relative subfolder structure where applicable) and refresh the tree.

## Acceptance Criteria
- Dragging a task item (single task document or grouped task/document node, as applicable) and dropping it onto the **Archived** folder archives the task.
- Archiving moves the file on disk from the active tasks folder to the archive folder (as configured by `workspaceShortcuts.tasksViewer.folderPath` and the archive location used by the Tasks Viewer).
- If the task is within a nested subfolder, the relative folder structure is preserved under the archive folder (e.g., `feature1/backlog/task.md` → `archive/feature1/backlog/task.md`).
- If the target archive subfolder path does not exist, it is created.
- The operation works on macOS, Linux, and Windows (path separators handled correctly).
- The tree view refreshes immediately and the item appears under Archived (when `showArchived` is enabled).
- If the user drops onto a non-Archived target, existing behavior is unchanged.
- If a name collision exists in the archive destination, the user is prompted to choose an outcome (e.g., cancel, overwrite, or auto-rename), or a safe default is applied consistently (document the chosen behavior).
- Appropriate error handling:
  - If the file cannot be moved (permissions, locked file, missing source), show a user-friendly error message.
  - No data loss: failures do not delete the source file.

## Subtasks
- [x] Locate current Tasks Viewer drag-and-drop implementation (tree drag controller / drag-and-drop controller) and identify how task items are represented during drag.
- [x] Identify the Archived folder tree item/node and how it is distinguished as a drop target.
- [x] Implement drop handler behavior for Archived target:
  - [x] Resolve source file path(s) from dragged data.
  - [x] Compute archive destination path preserving relative structure.
  - [x] Ensure destination directories exist.
  - [x] Move files safely (atomic move where possible; fallback copy+delete if needed).
  - [x] Handle collisions (cancel/overwrite/rename) per chosen UX.
- [x] Refresh Tasks tree data provider and ensure selection/focus behavior is reasonable after move.
- [x] Add/extend tests covering:
  - [x] Simple root task → archive
  - [x] Nested task → archive with structure preserved
  - [x] Collision handling
  - [x] Cross-platform path handling (use `path` utilities)
- [ ] Manual verification in VS Code:
  - [ ] Drag single task into Archived
  - [ ] Drag grouped document task into Archived (if supported)
  - [ ] Confirm tree updates and filesystem changes

## Notes
- Confirm the exact on-disk archive folder naming/location used by the Tasks Viewer (commonly `archive/` under the tasks root).
- Consider whether multi-select drag is supported; if so, archiving should support moving multiple files in one drop.
- Ensure the drag payload is not VS Code “resource” type only; if custom MIME is used, keep backward compatibility.
- Prefer using Node’s `fs.promises.rename` where possible; fall back to copy+unlink for cross-device moves.
- Keep behavior consistent with any existing “Archive task” command, if one exists (reuse implementation).
