# Delete Folder Feature for Task Panel

## Overview
Add the ability to delete folders directly from the Tasks Viewer context menu.

## Requirements
- Add `tasksViewer.deleteFolder` command
- Show confirmation dialog warning about recursive deletion
- Delete folder and all nested content (tasks, subfolders, documents)
- Update tree view after deletion

## Implementation Steps
1. Add `deleteFolder()` method to `TaskManager`
2. Add command handler in `TasksCommands`
3. Register command and menu item in `package.json`
4. Add unit tests

## Status
- [x] Completed
