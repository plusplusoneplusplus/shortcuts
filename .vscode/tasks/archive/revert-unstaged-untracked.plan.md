# Feature Plan: Revert Unstaged Changes and Untracked Files in Git Panel

## Problem Statement

Currently, the Git panel supports staging/unstaging files but lacks the ability to:
1. **Revert unstaged changes** - Discard modifications to tracked files (restore to last committed state)
2. **Delete untracked files** - Remove new files that haven't been committed

This forces users to switch to the native VS Code Git panel or use terminal commands for these operations.

## Proposed Approach

Add two new commands to the Git panel context menu:
- `gitView.discardChanges` - Revert unstaged modifications (calls `git checkout -- <file>`)
- `gitView.deleteUntrackedFile` - Delete untracked files (with confirmation)

## Workplan

- [x] **1. Add Git service methods**
  - [x] 1.1 Add `discardChanges(filePath: string)` method in `git-service.ts`
    - Use VS Code Git API's `revert` or execute `git checkout -- <file>`
  - [x] 1.2 Add `deleteUntrackedFile(filePath: string)` method in `git-service.ts`
    - Use `fs.unlink` to remove untracked files

- [x] **2. Register commands in `extension.ts`**
  - [x] 2.1 Add `gitView.discardChanges` command
    - Accept `GitChangeItem` parameter
    - Show confirmation dialog before discarding
    - Set loading state during operation
    - Show success/error notification
  - [x] 2.2 Add `gitView.deleteUntrackedFile` command
    - Accept `GitChangeItem` parameter
    - Show confirmation dialog (warn about permanent deletion)
    - Set loading state during operation
    - Show success/error notification

- [x] **3. Update `package.json` for menu contributions**
  - [x] 3.1 Add command declarations for both new commands
  - [x] 3.2 Add context menu entries:
    - `gitView.discardChanges` - Show for `viewItem =~ /^gitChange_unstaged/`
    - `gitView.deleteUntrackedFile` - Show for `viewItem =~ /^gitChange_untracked/`
  - [x] 3.3 Add inline button icons (optional)

- [x] **4. Add unit tests**
  - [x] 4.1 Test `discardChanges` method in GitService
  - [x] 4.2 Test `deleteUntrackedFile` method in GitService
  - [x] 4.3 Test command registration and context menu visibility

- [ ] **5. Manual testing & verification**
  - [ ] 5.1 Test reverting modified file restores original content
  - [ ] 5.2 Test deleting untracked file removes it from filesystem
  - [ ] 5.3 Verify confirmation dialogs appear correctly
  - [ ] 5.4 Verify loading spinners show during operations
  - [ ] 5.5 Verify tree view refreshes after operations

## Technical Details

### Git Service Methods

```typescript
// git-service.ts

/**
 * Discard unstaged changes to a file (restore to HEAD state)
 * @param filePath Absolute path to the file
 * @returns true if successful, false otherwise
 */
async discardChanges(filePath: string): Promise<boolean> {
    const repo = this.findRepositoryForFile(filePath);
    if (!repo) return false;
    
    // VS Code Git API checkout method restores file to HEAD
    await repo.clean([filePath]);  // or use git checkout via exec
    return true;
}

/**
 * Delete an untracked file from the filesystem
 * @param filePath Absolute path to the file
 * @returns true if successful, false otherwise
 */
async deleteUntrackedFile(filePath: string): Promise<boolean> {
    const repo = this.findRepositoryForFile(filePath);
    if (!repo) return false;
    
    // Use fs to delete the file
    await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
    return true;
}
```

### Command Registration Pattern (following existing stageFile pattern)

```typescript
// extension.ts

gitDiscardChangesCommand = vscode.commands.registerCommand(
    'gitView.discardChanges',
    async (item: GitChangeItem) => {
        if (item?.change?.path) {
            const filePath = item.change.path;
            
            // Confirmation dialog
            const confirm = await vscode.window.showWarningMessage(
                `Discard changes to "${path.basename(filePath)}"? This cannot be undone.`,
                { modal: true },
                'Discard'
            );
            if (confirm !== 'Discard') return;
            
            gitTreeDataProvider.setFileLoading(filePath);
            try {
                const success = await gitService.discardChanges(filePath);
                if (!success) {
                    vscode.window.showErrorMessage(`Failed to discard changes: ${filePath}`);
                }
            } finally {
                gitTreeDataProvider.clearFileLoading(filePath);
            }
        }
    }
);
```

### Package.json Menu Configuration

```json
{
  "command": "gitView.discardChanges",
  "title": "Discard Changes",
  "category": "Git",
  "icon": "$(discard)"
},
{
  "command": "gitView.deleteUntrackedFile",
  "title": "Delete File",
  "category": "Git",
  "icon": "$(trash)"
}
```

Context menu rules:
```json
{
  "command": "gitView.discardChanges",
  "when": "view == gitView && viewItem =~ /^gitChange_unstaged/",
  "group": "gitChange@2"
},
{
  "command": "gitView.deleteUntrackedFile",
  "when": "view == gitView && viewItem =~ /^gitChange_untracked/",
  "group": "gitChange@2"
}
```

## Notes & Considerations

1. **Safety**: Both operations are destructive - always show confirmation dialog
2. **Error handling**: Handle cases where file was already deleted/modified externally
3. **Loading state**: Reuse existing `setFileLoading`/`clearFileLoading` pattern
4. **VS Code Git API**: May need to use `clean()` method or fallback to exec git command
5. **Bulk operations**: Consider adding "Discard All" / "Delete All Untracked" later (future enhancement)

## Related Files

- `src/shortcuts/git/git-service.ts` - Add service methods
- `src/shortcuts/git/tree-data-provider.ts` - Loading state management (existing)
- `src/shortcuts/git/git-change-item.ts` - Tree item with contextValue
- `src/extension.ts` - Command registration
- `package.json` - Command declarations and menu contributions
