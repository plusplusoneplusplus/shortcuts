# Copy Relative Path for Task Panel Feature Item

## Description

Add a "Copy Relative Path" context menu action to task panel items, allowing users to quickly copy the relative file path of a task document to the clipboard. This feature improves workflow efficiency by providing easy access to file paths for referencing tasks in documentation, scripts, or other tools.

## Acceptance Criteria

- [ ] Context menu item "Copy Relative Path" appears when right-clicking on a task item in the Tasks panel
- [ ] Clicking the action copies the relative path (from workspace root) to the system clipboard
- [ ] Works for all task item types (single documents, grouped documents)
- [ ] Shows a notification confirming the path was copied
- [ ] Path uses forward slashes regardless of OS (consistent format)
- [ ] Command is registered and accessible via command palette

## Subtasks

- [ ] Add command `shortcuts.tasks.copyRelativePath` to command registration in `commands.ts`
- [ ] Implement command handler to extract relative path from task item
- [ ] Add context menu contribution in `package.json` for task panel items
- [ ] Add appropriate `when` clause to show only for file-based task items
- [ ] Add clipboard API integration to copy path
- [ ] Show success notification after copy
- [ ] Add tests for the new command functionality

## Technical Notes

- Reference existing "Copy Path" implementations in the codebase for consistency
- Use `vscode.env.clipboard.writeText()` for clipboard operations
- Use `vscode.workspace.asRelativePath()` to generate relative paths
- Task items are defined in `src/shortcuts/tasks/` directory
- Context menu items configured in `package.json` under `contributes.menus`

## Related Files

- `src/shortcuts/tasks/tasks-tree-data-provider.ts` - Task tree items
- `src/shortcuts/commands.ts` - Command registration
- `package.json` - Menu contributions

## Notes

- Consider also adding "Copy Absolute Path" as a companion feature
- Ensure keyboard shortcut doesn't conflict with existing shortcuts
