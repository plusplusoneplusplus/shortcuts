# Feature Folder Commands Cleanup

## Description

Feature folders in the Tasks Viewer should not display task-specific context menu commands such as "Mark as Future", "Archive", or other task lifecycle commands. These commands are only applicable to individual task documents, not to folder containers.

Currently, folder items may be showing commands that don't make sense for their context, leading to confusion or potential errors when users attempt to use them.

## Acceptance Criteria

- [ ] Feature folder context menu excludes "Mark as Future" command
- [ ] Feature folder context menu excludes "Archive" command  
- [ ] Feature folder context menu excludes other task-specific lifecycle commands
- [ ] Task documents within folders still retain all applicable commands
- [ ] Context menu shows only folder-appropriate actions (e.g., create task, rename, delete folder)

## Subtasks

- [ ] Identify all task-specific commands currently shown on folders
- [ ] Review `when` clause conditions in `package.json` for menu contributions
- [ ] Update `viewItem` context values to differentiate folders from tasks
- [ ] Add proper `when` clause filters to restrict commands to task items only
- [ ] Test folder context menus at all nesting levels
- [ ] Test task document context menus still work correctly

## Notes

- Check `package.json` menus section for `view/item/context` contributions
- The `viewItem` context key should distinguish between `taskFolder`, `taskDocument`, and `taskDocumentGroup`
- Consider if any folder-specific commands should be added (e.g., "Create Task in Folder")
- Ensure changes don't break existing keyboard shortcuts or command palette access
