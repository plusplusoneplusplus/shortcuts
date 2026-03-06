# New Task Respects Current Folder

## Problem

When the user clicks **+ New Task** while navigated into a non-root folder in the Tasks panel (e.g. `coc/git`), the new task file is created in the tasks root directory instead of the currently-selected folder. The new file should be created under the active folder.

## Acceptance Criteria

- [ ] Clicking **+ New Task** while a sub-folder is selected/active creates the new task file inside that folder (e.g. `.vscode/tasks/coc/git/<name>.md`).
- [ ] Clicking **+ New Task** from the root (no sub-folder selected) continues to create the file at the tasks root — no regression.
- [ ] The newly created file appears in the correct folder in the Tasks panel tree without requiring a manual refresh.
- [ ] The breadcrumb / path shown in the panel header (e.g. `coc/git`) reflects where the file will land before the user commits the name.

## Subtasks

1. **Identify where "+ New Task" creates the file** — find the handler/command in `packages/coc-server/` or `src/shortcuts/tasks-viewer/` that resolves the target directory for a new task.
2. **Pass current folder context** — ensure the active/selected folder path is available when the command is invoked (from the frontend breadcrumb state or tree selection).
3. **Update file-creation logic** — use the active folder path as the base directory instead of always defaulting to the tasks root.
4. **Update frontend if needed** — confirm the `+ New Task` button in the SPA dashboard passes the current folder context in the API request.
5. **Write/update tests** — add a test case: create task while a sub-folder is active → assert file path includes the sub-folder.

## Notes

- From the screenshot, the breadcrumb already shows `coc/git` when the `git` folder is selected — this context should already be available in the UI state.
- Be careful not to break the "New Folder" button, which may share similar creation logic.
- If the task name dialog is shown before the path is resolved, consider showing the target path in the dialog so the user can confirm where the file will be saved.
