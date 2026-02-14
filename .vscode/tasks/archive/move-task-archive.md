# Move Task Between Active and Archived

## Overview

Implement the ability to move tasks between Active Tasks and Archived Tasks in the Task Panel via context menu or drag-and-drop.

## Current State Analysis

The task viewer already has archive/unarchive functionality implemented:

### Existing Implementation

1. **TaskManager** (`task-manager.ts`):
   - `archiveTask(filePath)`: Moves task file to `archive/` folder
   - `unarchiveTask(filePath)`: Moves task from `archive/` to root tasks folder
   - `getArchiveFolder()`: Returns archive folder path (`.vscode/tasks/archive`)

2. **Commands** (`commands.ts`):
   - `tasksViewer.archive`: Archives a TaskItem
   - `tasksViewer.unarchive`: Unarchives a TaskItem
   - Both show info/error messages and refresh tree

3. **Tree Items** have proper `contextValue`:
   - `task` / `archivedTask` for TaskItem
   - `taskDocument` / `archivedTaskDocument` for TaskDocumentItem
   - `taskDocumentGroup` / `archivedTaskDocumentGroup` for TaskDocumentGroupItem

4. **Drag-Drop** (`tasks-drag-drop-controller.ts`):
   - Already rejects drops on archived folders with warning message

## Gap Analysis

### What's Missing

1. **Package.json Menu Contributions**: Need to verify `tasksViewer.archive` and `tasksViewer.unarchive` commands are registered in `package.json` with proper menu contributions for context menus.

2. **Drag-Drop to Archive Group**: Currently, dragging to TaskGroupItem ('archived') is not supported. User must use context menu.

3. **Document Group/Single Document Archive**: Archive commands only work on TaskItem, not TaskDocumentItem or TaskDocumentGroupItem.

## Implementation Tasks

- [x] Verify commands are in `package.json` contributions
- [x] Add context menu entries for archive/unarchive commands
- [x] Support TaskDocumentItem archive/unarchive
- [x] Support TaskDocumentGroupItem archive/unarchive (move all docs in group)
- [ ] Optional: Drag-drop to TaskGroupItem for archive/unarchive

## Command Menu Context Values

| Item Type | Active contextValue | Archived contextValue | Archive Command | Unarchive Command |
|-----------|---------------------|----------------------|-----------------|-------------------|
| TaskItem | `task` | `archivedTask` | ✅ | ✅ |
| TaskDocumentItem | `taskDocument` | `archivedTaskDocument` | ❌ Need to add | ❌ Need to add |
| TaskDocumentGroupItem | `taskDocumentGroup` | `archivedTaskDocumentGroup` | ❌ Need to add | ❌ Need to add |
| TaskFolderItem | `taskFolder` | `taskFolder_archived` | ❌ Future | ❌ Future |

## File Changes Required

1. **`package.json`**: Add menu contributions for archive/unarchive
2. **`commands.ts`**: Add document/group archive handlers
3. **`task-manager.ts`**: Add `archiveDocument()` and `archiveDocumentGroup()` methods if needed

## Settings Reference

- `workspaceShortcuts.tasksViewer.showArchived`: Must be `true` to see archived section

## Testing Checklist

- [x] Archive task via context menu
- [x] Unarchive task via context menu
- [x] Archive document via context menu
- [x] Unarchive document via context menu
- [x] Archive document group via context menu
- [x] Unarchive document group via context menu
- [x] Verify name collision handling (timestamp suffix)
- [x] Verify tree refreshes after operations
