---
status: todo
---

# Feature: Copy Commit Hash from Related Items

## Problem Statement

Users need the ability to copy the full commit hash from related commit items in the Tasks Viewer. Currently, commits can only be viewed (which opens git view or copies to clipboard as fallback), but there's no explicit "Copy Hash" context menu option for quick access.

## Current Behavior

- `RelatedCommitItem` in `related-items-tree-items.ts` stores the full hash in `relatedItem.hash`
- Click action triggers `tasksViewer.viewRelatedCommit` command
- Context value is `relatedCommit`
- Only `tasksViewer.removeRelatedItem` appears in context menu (from `package.json:2504`)

## Proposed Solution

Add a "Copy Commit Hash" context menu item for related commit items.

### Implementation

1. **Add command registration** in `discovery-commands.ts`:
   ```typescript
   vscode.commands.registerCommand(
       'tasksViewer.copyCommitHash',
       async (item: RelatedCommitItem) => {
           if (item.relatedItem.hash) {
               await vscode.env.clipboard.writeText(item.relatedItem.hash);
               vscode.window.showInformationMessage(`Copied: ${item.relatedItem.hash}`);
           }
       }
   );
   ```

2. **Register command in `package.json`**:
   - Add to `contributes.commands` array
   - Add to `contributes.menus.view/item/context` with condition `viewItem == relatedCommit`

## Workplan

- [ ] Add `tasksViewer.copyCommitHash` command definition in `package.json` contributes.commands
- [ ] Add context menu entry in `package.json` contributes.menus.view/item/context
- [ ] Register command handler in `discovery-commands.ts`
- [ ] Test copy functionality works correctly

## Files to Modify

- `package.json` - Command definition and menu entry
- `src/shortcuts/tasks-viewer/discovery-commands.ts` - Command handler

## Notes

- The `RelatedCommitItem` class already exposes `relatedItem.hash` for the full commit hash
- Use short hash (7 chars) in notification message, but copy full hash to clipboard
- Place menu item in `relatedItem` group alongside existing "Remove Related Item"
