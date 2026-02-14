# Add Copy Path Menu Items for Task Folders

## Problem

When right-clicking a **feature folder** (`TaskFolderItem`) in the Task Panel, there are no "Copy Relative Path" / "Copy Full Path" options in the context menu. These options currently exist only for `task` and `archivedTask` items, but not for folders.

## Current State

- `tasksViewer.copyRelativePath` and `tasksViewer.copyFullPath` commands exist in `commands.ts` (lines ~516-580)
- The `copyPath()` handler accepts `TaskItem | TaskDocumentItem | TaskDocumentGroupItem` but **not** `TaskFolderItem`
- In `package.json`, copy menu entries have `when: "viewItem == task"` and `when: "viewItem == archivedTask"` — folders are excluded
- `TaskFolderItem` has `folder.folderPath` (absolute path) and `folder.relativePath` (relative to tasks root)
- Folder `contextValue` follows pattern: `taskFolder[_archived][_hasRelated]`

## Proposed Approach

Minimal, surgical changes in two files:

### 1. Update `commands.ts` — extend `copyPath()` to handle `TaskFolderItem`

- Import `TaskFolderItem` (if not already imported)
- In `copyPath()`, add a branch for `TaskFolderItem`:
  - Use `item.folder.folderPath` for absolute path
  - Use `vscode.workspace.asRelativePath()` for relative path
- Update the type signature to include `TaskFolderItem`

### 2. Update `package.json` — add context menu entries for folders

Add 4 new entries under `view/item/context` (2 for active folders, 2 for archived):

```json
{
  "command": "tasksViewer.copyRelativePath",
  "when": "view == tasksView && viewItem =~ /^taskFolder/ && viewItem !~ /_archived/",
  "group": "copy@1"
},
{
  "command": "tasksViewer.copyFullPath",
  "when": "view == tasksView && viewItem =~ /^taskFolder/ && viewItem !~ /_archived/",
  "group": "copy@2"
},
{
  "command": "tasksViewer.copyRelativePath",
  "when": "view == tasksView && viewItem =~ /^taskFolder.*_archived/",
  "group": "copy@1"
},
{
  "command": "tasksViewer.copyFullPath",
  "when": "view == tasksView && viewItem =~ /^taskFolder.*_archived/",
  "group": "copy@2"
}
```

> **Note:** Since both archived and non-archived folders should have copy path, this can be simplified to 2 entries using `viewItem =~ /^taskFolder/`:
>
> ```json
> {
>   "command": "tasksViewer.copyRelativePath",
>   "when": "view == tasksView && viewItem =~ /^taskFolder/",
>   "group": "copy@1"
> },
> {
>   "command": "tasksViewer.copyFullPath",
>   "when": "view == tasksView && viewItem =~ /^taskFolder/",
>   "group": "copy@2"
> }
> ```

### 3. (Optional) Also add for `taskDocument` and `taskDocumentGroup`

The `copyPath()` handler already supports `TaskDocumentItem` and `TaskDocumentGroupItem` in its implementation, but the `package.json` menu entries are missing for these item types. Consider adding them too for completeness. This is a separate concern and can be done independently.

## Files to Change

1. `src/shortcuts/tasks-viewer/commands.ts` — extend `copyPath()` type signature and add `TaskFolderItem` branch
2. `package.json` — add 2 context menu entries under `view/item/context`

## Testing

- Compile: `npm run compile`
- Verify right-click on a folder in Task Panel shows "Copy Relative Path" and "Copy Full Path"
- Verify both active and archived folders show the menu items
- Verify copied paths are correct (relative and absolute)
