# Drag Opened MD File into Task Panel (Move Instead of Copy)

## Problem

Currently, when an external `.md` file is dragged onto the **Active Tasks** group in the Task Panel, the file is **copied** (via `importTask` which reads content and writes a new file). The user wants:

1. **Move** the file instead of copying it (delete source after placing in tasks folder)
2. Allow dropping external `.md` files onto **feature folders** (currently only "Active Tasks" group accepts external drops)

## Current Behavior

- **External drop on "Active Tasks" group**: Calls `importTask()` → reads file content → writes new file in tasks root → **original file untouched** (copy semantics)
- **External drop on TaskFolderItem**: **Not supported** — external drops are rejected; only internal drag data is accepted on folders
- **Internal drag between folders**: Uses `moveTask()` → calls `safeRename()` → true move semantics ✅

## Proposed Approach

### Strategy: Modify external drop handling to use move semantics and support folder targets

The changes are minimal and surgical:

1. **TaskManager**: Add a `moveExternalTask()` method that moves (renames) an external `.md` file into a specified target folder (with collision handling), rather than copying content
2. **TasksDragDropController**: Extend `handleDrop()` to:
   - Accept external `text/uri-list` drops on **TaskFolderItem** (non-archived) in addition to Active Tasks group
   - Call the new move method instead of `importTask()`
   - Delete the source file after successful move
3. **Tests**: Update existing import tests and add new tests for move behavior and folder-target drops

## Workplan

- [x] **1. Add `moveExternalTask()` to TaskManager** (`task-manager.ts`)
  - New method: `moveExternalTask(sourcePath: string, targetFolder?: string, newName?: string): Promise<string>`
  - Uses `safeRename()` (same as `moveTask()`) to move the file
  - If `targetFolder` not specified, defaults to tasks root folder
  - Handles collision detection (prompt for rename if exists)
  - Validates source file exists and is `.md`

- [x] **2. Update `handleDrop()` in `TasksDragDropController`** (`tasks-drag-drop-controller.ts`)
  - Expand external drop target check: accept drops on both `TaskGroupItem` (active) and `TaskFolderItem` (non-archived)
  - Determine target folder based on drop target type
  - Replace `importTask()` call with `moveExternalTask()` (move semantics)
  - Update success messages to say "moved" instead of "imported"

- [x] **3. Update `importFileWithCollisionHandling()`** (`tasks-drag-drop-controller.ts`)
  - Rename to `moveFileWithCollisionHandling()` or add a `targetFolder` parameter
  - Pass target folder to the new move method
  - Collision handling stays the same (prompt for new name)

- [x] **4. Add tests for move behavior** (`tasks-viewer.test.ts`)
  - Test: external drop moves file (source deleted, target created)
  - Test: external drop onto feature folder places file in that folder
  - Test: collision handling still works with move
  - Test: non-md files are still rejected
  - Test: drop on archived folder is rejected for external files

- [x] **5. Update existing import tests** (`tasks-viewer.test.ts`)
  - Rename/update `TaskManager importTask` test suite if `importTask` is replaced
  - Or keep `importTask` for programmatic use and add `moveExternalTask` alongside

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Move vs Copy | **Move** (delete source) | User explicitly requested move semantics |
| Keep `importTask`? | **Yes**, keep as internal API | Other code paths may use copy semantics; move is for drag-drop only |
| Target folder support | **TaskFolderItem + Active Tasks root** | Natural UX: drop on any non-archived folder |
| Archived folders | **Reject external drops** | Archived folders should only receive internal archive operations |
| Method name | `moveExternalTask()` | Distinguishes from internal `moveTask()` which has different collision handling |

## Files to Modify

| File | Change |
|------|--------|
| `src/shortcuts/tasks-viewer/task-manager.ts` | Add `moveExternalTask()` method |
| `src/shortcuts/tasks-viewer/tasks-drag-drop-controller.ts` | Extend external drop targets, use move instead of copy |
| `src/test/suite/tasks-viewer.test.ts` | Add/update tests for move behavior |

## Notes

- The `safeRename()` utility (used by `moveTask()`) already handles cross-device moves gracefully
- File watchers already use recursive glob `**/*.md`, so moved files will be detected automatically
- No changes needed to `extension.ts` — the drag-drop controller registration stays the same
- No changes to MIME types — `text/uri-list` already supports external file drops
