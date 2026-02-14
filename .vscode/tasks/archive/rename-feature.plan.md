# Add Rename Feature Support in Task Panel

## Overview

Extend the rename functionality in the Tasks Viewer panel to support renaming:
1. **Folders** (`TaskFolderItem`) - Currently not supported
2. **Document Groups** (`TaskDocumentGroupItem`) - Currently not supported
3. **Individual Documents** (`TaskDocumentItem`) - Need to verify/add support

Currently, only `TaskItem` (single task files) supports rename via the `tasksViewer.rename` command.

## Current State Analysis

### Existing Rename Support
- `commands.ts`: `renameTask(item: TaskItem)` handles single task file rename
- `task-manager.ts`: `renameTask(oldPath, newName)` performs the actual file rename
- `package.json`: Menu item registered for `viewItem == task` only

### Missing Rename Support
- **TaskFolder**: No `renameFolder()` method, no command, no menu entry
- **TaskDocumentGroup**: No `renameDocumentGroup()` method, no command, no menu entry
- **TaskDocument**: No `renameDocument()` method (may reuse renameTask), no command, no menu entry

## Implementation Plan

### Phase 1: Task Manager Methods

- [x] **1.1** Add `renameFolder(folderPath: string, newName: string)` method in `task-manager.ts`
  - Validate folder exists
  - Sanitize new folder name
  - Check for name collision
  - Use `fs.renameSync()` to rename directory
  - Return new folder path

- [x] **1.2** Add `renameDocumentGroup(folderPath: string, oldBaseName: string, newBaseName: string)` method
  - Find all documents with the old base name in the folder
  - Rename each document, preserving the doc type suffix (e.g., `.plan`, `.spec`)
  - Handle partial failures (rollback if needed, or report which files were renamed)
  - Return array of new file paths

- [x] **1.3** Add `renameDocument(oldPath: string, newName: string)` method (if different from `renameTask`)
  - May be able to reuse `renameTask()` logic
  - Ensure doc type suffix is preserved or handled correctly

### Phase 2: Command Handlers

- [x] **2.1** Add `renameFolder(item: TaskFolderItem)` in `commands.ts`
  - Show input box with current folder name
  - Validate input (non-empty, no path separators)
  - Call `taskManager.renameFolder()`
  - Refresh tree view

- [x] **2.2** Add `renameDocumentGroup(item: TaskDocumentGroupItem)` in `commands.ts`
  - Show input box with current base name
  - Validate input
  - Call `taskManager.renameDocumentGroup()`
  - Refresh tree view

- [x] **2.3** Add `renameDocument(item: TaskDocumentItem)` in `commands.ts` (if needed)
  - Similar pattern to `renameTask()`

### Phase 3: Command Registration

- [x] **3.1** Register new commands in `registerCommands()`:
  - `tasksViewer.renameFolder`
  - `tasksViewer.renameDocumentGroup`
  - `tasksViewer.renameDocument` (if separate from existing)

### Phase 4: Package.json Configuration

- [x] **4.1** Add command definitions in `contributes.commands`:
  ```json
  {
    "command": "tasksViewer.renameFolder",
    "title": "Rename Folder",
    "icon": "$(edit)"
  },
  {
    "command": "tasksViewer.renameDocumentGroup",
    "title": "Rename Document Group",
    "icon": "$(edit)"
  }
  ```

- [x] **4.2** Add menu items in `contributes.menus.view/item/context`:
  ```json
  {
    "command": "tasksViewer.renameFolder",
    "when": "view == tasksView && viewItem =~ /^taskFolder/",
    "group": "task@1"
  },
  {
    "command": "tasksViewer.renameDocumentGroup",
    "when": "view == tasksView && viewItem == taskDocumentGroup",
    "group": "task@1"
  }
  ```

### Phase 5: Testing

- [x] **5.1** Add unit tests for new `TaskManager` methods
  - Test folder rename with valid/invalid inputs
  - Test document group rename
  - Test edge cases (name collisions, non-existent folders)

- [x] **5.2** Add command handler tests (if test patterns exist)

- [ ] **5.3** Manual testing
  - Test renaming folders at root and nested levels
  - Test renaming document groups
  - Test with archived folders
  - Verify tree view refresh after rename

## Files to Modify

| File | Changes |
|------|---------|
| `src/shortcuts/tasks-viewer/task-manager.ts` | Add `renameFolder()`, `renameDocumentGroup()`, `renameDocument()` methods |
| `src/shortcuts/tasks-viewer/commands.ts` | Add command handlers, register commands |
| `package.json` | Add command definitions and menu items |
| `src/test/suite/` | Add test files for new functionality |

## Edge Cases to Handle

1. **Archived folders** - Should renaming be allowed? Consider blocking or preserving archive status
2. **Nested folders** - Renaming parent should not affect children paths
3. **Open files** - If a file being renamed is open in editor, handle gracefully
4. **Name collisions** - Check if new name already exists before renaming
5. **Special characters** - Sanitize folder/file names consistently

## Notes

- The existing `renameTask()` pattern in `commands.ts` provides a good template
- Context value patterns: `taskFolder`, `taskFolder_archived`, `taskFolder_hasRelated`
- Consider adding keybinding (F2) for rename operations
