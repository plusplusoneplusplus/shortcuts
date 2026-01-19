import * as path from 'path';
import * as vscode from 'vscode';
import { GlobalNotesTreeDataProvider } from './global-notes';
import { LogicalTreeDataProvider } from './logical-tree-data-provider';
import { NotificationManager } from './notification-manager';
import { CommandShortcutItem, CommitShortcutItem, FileShortcutItem, FolderShortcutItem, GlobalNoteItem, LogicalGroupChildItem, LogicalGroupItem, NoteShortcutItem, TaskShortcutItem } from './tree-items';
import { getExtensionLogger, LogCategory } from './shared/extension-logger';
import { getWorkspaceRoot, getWorkspaceRootUri } from './shared/workspace-utils';

/**
 * Command handlers for the shortcuts panel
 */
export class ShortcutsCommands {
    constructor(
        private treeDataProvider: LogicalTreeDataProvider,
        private updateSearchDescriptions?: () => void,
        private _unusedSearchProvider?: any,
        private treeView?: vscode.TreeView<any>,
        private noteDocumentManager?: any, // Will be typed properly when wired up
        private globalNotesTreeDataProvider?: GlobalNotesTreeDataProvider
    ) { }

    /**
     * Register all command handlers
     * @param context Extension context for registering disposables
     * @returns Array of disposables for cleanup
     */
    registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];

        // Refresh shortcuts command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.refresh', () => {
                this.refreshShortcuts();
            })
        );

        // Reset configuration command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.resetConfiguration', async () => {
                await this.resetConfiguration();
            })
        );

        // Open configuration file command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.openConfiguration', async () => {
                await this.openConfiguration();
            })
        );

        // Show extension logs command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.showLogs', () => {
                const logger = getExtensionLogger();
                logger.show(false); // false = don't preserve focus, bring it to front
            })
        );

        // Logical group management commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.createLogicalGroup', async () => {
                await this.createLogicalGroup();
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.addToLogicalGroup', async (item: LogicalGroupItem) => {
                await this.addToLogicalGroup(item);
            })
        );

        // Windows-only: Separate add files/folders commands to avoid mixed dialog limitation
        disposables.push(
            vscode.commands.registerCommand('shortcuts.addFilesToLogicalGroup', async (item: LogicalGroupItem) => {
                await this.addFilesToLogicalGroup(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.addFoldersToLogicalGroup', async (item: LogicalGroupItem) => {
                await this.addFoldersToLogicalGroup(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.removeFromLogicalGroup', async (item: LogicalGroupChildItem | CommitShortcutItem) => {
                await this.removeFromLogicalGroup(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.renameLogicalGroup', async (item: LogicalGroupItem) => {
                await this.renameLogicalGroup(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.deleteLogicalGroup', async (item: LogicalGroupItem) => {
                await this.deleteLogicalGroup(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.createNestedLogicalGroup', async (item: LogicalGroupItem) => {
                await this.createNestedLogicalGroup(item);
            })
        );

        // Copy path commands (work for both physical and logical items)
        disposables.push(
            vscode.commands.registerCommand('shortcuts.copyRelativePath', async (item: FolderShortcutItem | FileShortcutItem | LogicalGroupChildItem) => {
                await this.copyPath(item, false);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.copyAbsolutePath', async (item: FolderShortcutItem | FileShortcutItem | LogicalGroupChildItem) => {
                await this.copyPath(item, true);
            })
        );

        // Create file/folder in logical group commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.createFileInLogicalGroup', async (item: LogicalGroupItem) => {
                await this.createFileInLogicalGroup(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.createFolderInLogicalGroup', async (item: LogicalGroupItem) => {
                await this.createFolderInLogicalGroup(item);
            })
        );

        // Create file/folder in subfolder commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.createFileInFolder', async (item: LogicalGroupChildItem | FolderShortcutItem) => {
                await this.createFileInFolder(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.createFolderInFolder', async (item: LogicalGroupChildItem | FolderShortcutItem) => {
                await this.createFolderInFolder(item);
            })
        );

        // Reveal in explorer and terminal commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.revealInExplorer', async (item: LogicalGroupChildItem | FolderShortcutItem | FileShortcutItem) => {
                await this.revealInExplorer(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.openInTerminal', async (item: LogicalGroupChildItem | FolderShortcutItem | FileShortcutItem) => {
                await this.openInTerminal(item);
            })
        );

        // Command and task execution
        disposables.push(
            vscode.commands.registerCommand('shortcuts.executeCommandItem', async (item: CommandShortcutItem) => {
                await this.executeCommandItem(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.executeTaskItem', async (item: TaskShortcutItem) => {
                await this.executeTaskItem(item);
            })
        );

        // Note commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.createNote', async (item: LogicalGroupItem) => {
                await this.createNote(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.editNote', async (item: NoteShortcutItem) => {
                await this.editNote(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.deleteNote', async (item: NoteShortcutItem) => {
                await this.deleteNote(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.renameNote', async (item: NoteShortcutItem) => {
                await this.renameNote(item);
            })
        );

        // Global note commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.createGlobalNote', async () => {
                await this.createGlobalNote();
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.editGlobalNote', async (item: GlobalNoteItem) => {
                await this.editGlobalNote(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.deleteGlobalNote', async (item: GlobalNoteItem) => {
                await this.deleteGlobalNote(item);
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.renameGlobalNote', async (item: GlobalNoteItem) => {
                await this.renameGlobalNote(item);
            })
        );

        // Sync commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.sync.configure', async () => {
                await this.configureSyncCommand();
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.sync.enable', async () => {
                await this.enableSyncCommand();
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.sync.disable', async () => {
                await this.disableSyncCommand();
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.sync.now', async () => {
                await this.syncNowCommand();
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.sync.status', async () => {
                await this.syncStatusCommand();
            })
        );

        return disposables;
    }

    /**
     * Refresh the shortcuts tree view
     */
    private refreshShortcuts(): void {
        this.treeDataProvider.refresh();
        NotificationManager.showInfo('Shortcuts refreshed!', { timeout: 2000 });
    }

    /**
     * Open a file in the editor, respecting user preferences for markdown files
     * @param fileUri URI of the file to open
     */
    private async openFile(fileUri: vscode.Uri): Promise<void> {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        const alwaysOpenMarkdownInReviewEditor = config.get<boolean>('alwaysOpenMarkdownInReviewEditor', false);

        // Check if it's a markdown file
        const isMarkdown = fileUri.fsPath.toLowerCase().endsWith('.md');

        if (isMarkdown && alwaysOpenMarkdownInReviewEditor) {
            // Open in Review Editor View
            await vscode.commands.executeCommand(
                'vscode.openWith',
                fileUri,
                'reviewEditorView'
            );
        } else {
            // Open normally in text editor
            await vscode.window.showTextDocument(fileUri);
        }
    }

    /**
     * Reset configuration to default
     */
    private async resetConfiguration(): Promise<void> {
        try {
            // Confirm reset
            const confirmation = await NotificationManager.showWarning(
                'Are you sure you want to reset the shortcuts configuration? This will remove all existing shortcuts.',
                { timeout: 0, actions: ['Reset'] }
            );

            if (confirmation !== 'Reset') {
                return; // User cancelled
            }

            // Reset using configuration manager
            const configManager = this.treeDataProvider.getConfigurationManager();
            const { DEFAULT_SHORTCUTS_CONFIG } = await import('./types');
            await configManager.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);

            // Refresh the tree view
            this.treeDataProvider.refresh();

            NotificationManager.showInfo('Configuration reset to default successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error resetting configuration', err);
            NotificationManager.showError(`Failed to reset configuration: ${err.message}`);
        }
    }

    /**
     * Open the configuration file in the editor
     */
    private async openConfiguration(): Promise<void> {
        try {
            const configManager = this.treeDataProvider.getConfigurationManager();
            const configPath = configManager.getConfigPath();
            const configUri = vscode.Uri.file(configPath);

            // Only create the file if it doesn't exist - don't overwrite existing configuration
            const fs = require('fs');
            if (!fs.existsSync(configPath)) {
                const { DEFAULT_SHORTCUTS_CONFIG } = await import('./types');
                await configManager.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);
            }

            // Open the configuration file
            await vscode.window.showTextDocument(configUri);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error opening configuration file', err);
            NotificationManager.showError(`Failed to open configuration file: ${err.message}`);
        }
    }


    /**
     * Create a new logical group
     */
    private async createLogicalGroup(): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            const groupName = await vscode.window.showInputBox({
                prompt: 'Enter a name for the logical group',
                placeHolder: 'Group name',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Group name cannot be empty';
                    }
                    return null;
                }
            });

            if (!groupName) {
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: 'Enter a description for the group (optional)',
                placeHolder: 'Group description'
            });

            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.createLogicalGroup(groupName.trim(), description?.trim());

            this.treeDataProvider.refresh();
            NotificationManager.showInfo('Logical group created successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error creating logical group', err);
            NotificationManager.showError(`Failed to create logical group: ${err.message}`);
        }
    }

    /**
     * Create a nested logical group within a parent group
     */
    private async createNestedLogicalGroup(parentGroup: LogicalGroupItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            const groupName = await vscode.window.showInputBox({
                prompt: `Enter a name for the new group inside "${parentGroup.originalName}"`,
                placeHolder: 'Subgroup name',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Group name cannot be empty';
                    }
                    return null;
                }
            });

            if (!groupName) {
                return;
            }

            const description = await vscode.window.showInputBox({
                prompt: 'Enter a description for the group (optional)',
                placeHolder: 'Group description'
            });

            // Build the parent group path
            const parentGroupPath = parentGroup.parentGroupPath
                ? `${parentGroup.parentGroupPath}/${parentGroup.originalName}`
                : parentGroup.originalName;

            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.createNestedLogicalGroup(parentGroupPath, groupName.trim(), description?.trim());

            this.treeDataProvider.refresh();
            NotificationManager.showInfo(`Subgroup "${groupName}" created successfully!`, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error creating nested logical group', err);
            NotificationManager.showError(`Failed to create subgroup: ${err.message}`);
        }
    }

    /**
     * Add folders or files to a logical group (supports multi-select)
     */
    private async addToLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Cross-platform default: allow mixed selection where supported (macOS/Linux)
            // On Windows this command will be hidden in menus; users use dedicated commands instead.
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: true,
                openLabel: 'Add Files and Folders to Group',
                title: `Select files and folders to add to "${groupItem.label}"`,
                defaultUri: getWorkspaceRootUri()
            });

            if (!uris || uris.length === 0) {
                return;
            }

            const configManager = this.treeDataProvider.getConfigurationManager();
            const fs = require('fs');
            let addedCount = 0;
            let skippedCount = 0;

            // Process each selected item
            for (const uri of uris) {
                try {
                    // Automatically detect the type based on what was selected
                    const stat = fs.statSync(uri.fsPath);
                    const itemType = stat.isDirectory() ? 'folder' : 'file';

                    // Use the filename as the default display name
                    const defaultName = path.basename(uri.fsPath);

                    // Build the full group path for nested groups
                    const groupPath = groupItem.parentGroupPath
                        ? `${groupItem.parentGroupPath}/${groupItem.originalName}`
                        : groupItem.originalName;

                    await configManager.addToLogicalGroup(
                        groupPath,
                        uri.fsPath,
                        defaultName,
                        itemType
                    );

                    addedCount++;
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    getExtensionLogger().warn(LogCategory.CONFIG, `Failed to add ${uri.fsPath}`, { error: err.message });
                    skippedCount++;
                }
            }

            this.treeDataProvider.refresh();

            // Show appropriate success message based on results
            if (addedCount > 0 && skippedCount === 0) {
                const itemText = addedCount === 1 ? 'item' : 'items';
                NotificationManager.showInfo(`${addedCount} ${itemText} added to group "${groupItem.label}" successfully!`, { timeout: 3000 });
            } else if (addedCount > 0 && skippedCount > 0) {
                NotificationManager.showWarning(`${addedCount} items added successfully, ${skippedCount} items skipped (may already exist in group).`);
            } else {
                NotificationManager.showWarning('No items were added. They may already exist in the group.');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error adding to logical group', err);
            NotificationManager.showError(`Failed to add to logical group: ${err.message}`);
        }
    }

    /**
     * Windows-only convenience: Add only files to a logical group
     */
    private async addFilesToLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        try {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: true,
                openLabel: 'Add Files to Group',
                title: `Select files to add to "${groupItem.label}"`,
                defaultUri: getWorkspaceRootUri()
            });
            if (!uris || uris.length === 0) {
                return;
            }

            const configManager = this.treeDataProvider.getConfigurationManager();
            const fs = require('fs');
            let addedCount = 0;
            let skippedCount = 0;

            for (const uri of uris) {
                try {
                    const stat = fs.statSync(uri.fsPath);
                    if (stat.isDirectory()) {
                        // Skip folders when adding files-only
                        skippedCount++;
                        continue;
                    }
                    const defaultName = path.basename(uri.fsPath);

                    // Build the full group path for nested groups
                    const groupPath = groupItem.parentGroupPath
                        ? `${groupItem.parentGroupPath}/${groupItem.originalName}`
                        : groupItem.originalName;

                    await configManager.addToLogicalGroup(
                        groupPath,
                        uri.fsPath,
                        defaultName,
                        'file'
                    );
                    addedCount++;
                } catch (e) {
                    skippedCount++;
                }
            }

            this.treeDataProvider.refresh();
            if (addedCount > 0 && skippedCount === 0) {
                const itemText = addedCount === 1 ? 'file' : 'files';
                NotificationManager.showInfo(`${addedCount} ${itemText} added to group "${groupItem.label}" successfully!`, { timeout: 3000 });
            } else if (addedCount > 0 && skippedCount > 0) {
                NotificationManager.showWarning(`${addedCount} files added successfully, ${skippedCount} items skipped.`);
            } else {
                NotificationManager.showWarning('No files were added.');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error adding files to logical group', err);
            NotificationManager.showError(`Failed to add files: ${err.message}`);
        }
    }

    /**
     * Windows-only convenience: Add only folders to a logical group
     */
    private async addFoldersToLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        try {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: true,
                openLabel: 'Add Folders to Group',
                title: `Select folders to add to "${groupItem.label}"`,
                defaultUri: getWorkspaceRootUri()
            });
            if (!uris || uris.length === 0) {
                return;
            }

            const configManager = this.treeDataProvider.getConfigurationManager();
            const fs = require('fs');
            let addedCount = 0;
            let skippedCount = 0;

            for (const uri of uris) {
                try {
                    const stat = fs.statSync(uri.fsPath);
                    if (!stat.isDirectory()) {
                        // Skip files when adding folders-only
                        skippedCount++;
                        continue;
                    }
                    const defaultName = path.basename(uri.fsPath);

                    // Build the full group path for nested groups
                    const groupPath = groupItem.parentGroupPath
                        ? `${groupItem.parentGroupPath}/${groupItem.originalName}`
                        : groupItem.originalName;

                    await configManager.addToLogicalGroup(
                        groupPath,
                        uri.fsPath,
                        defaultName,
                        'folder'
                    );
                    addedCount++;
                } catch (e) {
                    skippedCount++;
                }
            }

            this.treeDataProvider.refresh();
            if (addedCount > 0 && skippedCount === 0) {
                const itemText = addedCount === 1 ? 'folder' : 'folders';
                NotificationManager.showInfo(`${addedCount} ${itemText} added to group "${groupItem.label}" successfully!`, { timeout: 3000 });
            } else if (addedCount > 0 && skippedCount > 0) {
                NotificationManager.showWarning(`${addedCount} folders added successfully, ${skippedCount} items skipped.`);
            } else {
                NotificationManager.showWarning('No folders were added.');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error adding folders to logical group', err);
            NotificationManager.showError(`Failed to add folders: ${err.message}`);
        }
    }

    /**
     * Remove an item from a logical group (supports multi-selection)
     * Handles both file/folder items (LogicalGroupChildItem) and commit items (CommitShortcutItem)
     */
    private async removeFromLogicalGroup(item: LogicalGroupChildItem | CommitShortcutItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get all selected items from the tree view
            const selectedItems = this.treeView?.selection || [item];
            
            // Helper to check if item is a commit (using contextValue since instanceof may not work across module boundaries)
            const isCommitItem = (i: any): i is CommitShortcutItem => {
                return i?.contextValue === 'logicalGroupItem_commit' && 'commitHash' in i && 'parentGroup' in i;
            };
            
            // Helper to check if item is a file/folder child item
            const isGroupChildItem = (i: any): i is LogicalGroupChildItem => {
                return (i?.contextValue === 'logicalGroupItem_folder' || i?.contextValue === 'logicalGroupItem_file') 
                    && 'parentGroup' in i && 'fsPath' in i;
            };
            
            // Separate file/folder items from commit items
            const groupChildItems = selectedItems.filter(isGroupChildItem);
            const commitItems = selectedItems.filter(isCommitItem);

            if (groupChildItems.length === 0 && commitItems.length === 0) {
                // Check the passed item directly
                if (isCommitItem(item)) {
                    commitItems.push(item);
                } else if (isGroupChildItem(item)) {
                    groupChildItems.push(item);
                } else {
                    getExtensionLogger().warn(LogCategory.CONFIG, 'removeFromLogicalGroup: item is neither commit nor file/folder', { item });
                    return;
                }
            }

            // Remove all selected items (no confirmation prompt)
            const configManager = this.treeDataProvider.getConfigurationManager();
            
            // Remove file/folder items
            for (const childItem of groupChildItems) {
                await configManager.removeFromLogicalGroup(childItem.parentGroup, childItem.fsPath);
            }
            
            // Remove commit items
            for (const commitItem of commitItems) {
                getExtensionLogger().debug(LogCategory.GIT, `Removing commit ${commitItem.commitHash} from group ${commitItem.parentGroup}`);
                await configManager.removeCommitFromLogicalGroup(commitItem.parentGroup, commitItem.commitHash);
            }

            this.treeDataProvider.refresh();

            const totalRemoved = groupChildItems.length + commitItems.length;
            const successMessage = totalRemoved === 1
                ? 'Item removed from logical group successfully!'
                : `${totalRemoved} items removed from groups successfully!`;
            NotificationManager.showInfo(successMessage, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error removing from logical group', err);
            NotificationManager.showError(`Failed to remove from logical group: ${err.message}`);
        }
    }

    /**
     * Rename a logical group
     */
    private async renameLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter a new name for the logical group',
                placeHolder: 'Group name',
                value: groupItem.originalName,
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Group name cannot be empty';
                    }
                    return null;
                }
            });

            if (!newName || newName.trim() === groupItem.originalName) {
                return;
            }

            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.renameLogicalGroup(groupItem.originalName, newName.trim());

            this.treeDataProvider.refresh();
            NotificationManager.showInfo('Logical group renamed successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error renaming logical group', err);
            NotificationManager.showError(`Failed to rename logical group: ${err.message}`);
        }
    }

    /**
     * Delete a logical group (supports multi-selection)
     */
    private async deleteLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Prefer the explicitly provided item to avoid cross-module instanceof issues
            // Prefer the explicitly provided item; fall back to selection only if none provided
            let groupItems: LogicalGroupItem[] = [];
            if (groupItem) {
                groupItems = [groupItem];
            } else {
                const selection = this.treeView?.selection;
                if (selection && selection.length > 0) {
                    groupItems = selection
                        .filter((i: any) => i && (i.contextValue === 'logicalGroup' || i.originalName))
                        .map((i: any) => (i as LogicalGroupItem));
                }
            }

            if (groupItems.length === 0) {
                return;
            }

            // Confirm deletion
            const groupNameForMessage = (gi: LogicalGroupItem) => {
                const label = (gi.label as any)?.label ?? gi.label ?? '';
                return typeof label === 'string' ? label : String(label);
            };
            const message = groupItems.length === 1
                ? `Are you sure you want to delete the logical group "${groupNameForMessage(groupItems[0])}"? This will remove all items from the group.`
                : `Are you sure you want to delete ${groupItems.length} logical groups? This will remove all items from these groups.`;

            const confirmation = await NotificationManager.showWarning(
                message,
                { timeout: 0, actions: ['Delete'] }
            );

            if (confirmation !== 'Delete') {
                return;
            }

            // Delete all selected groups
            const configManager = this.treeDataProvider.getConfigurationManager();
            for (const group of groupItems) {
                await configManager.deleteLogicalGroup(group.originalName);
            }

            this.treeDataProvider.refresh();

            const successMessage = groupItems.length === 1
                ? 'Logical group deleted successfully!'
                : `${groupItems.length} logical groups deleted successfully!`;
            NotificationManager.showInfo(successMessage, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error deleting logical group', err);
            NotificationManager.showError(`Failed to delete logical group: ${err.message}`);
        }
    }

    /**
     * Copy the path of an item to clipboard (supports multi-selection)
     * @param item The tree item to copy the path from
     * @param absolute Whether to copy absolute or relative path
     */
    private async copyPath(item: FolderShortcutItem | FileShortcutItem | LogicalGroupChildItem, absolute: boolean): Promise<void> {
        try {
            // Determine which tree view to use based on item type
            const treeView = item instanceof LogicalGroupChildItem ? this.treeView : this.treeView;
            const selectedItems = treeView?.selection || [item];

            // Filter items that have valid paths
            const validItems = selectedItems.filter(i =>
                i instanceof FolderShortcutItem ||
                i instanceof FileShortcutItem ||
                i instanceof LogicalGroupChildItem
            ) as (FolderShortcutItem | FileShortcutItem | LogicalGroupChildItem)[];

            if (validItems.length === 0) {
                NotificationManager.showError('No valid items selected');
                return;
            }

            // Collect all paths
            const paths: string[] = [];
            for (const validItem of validItems) {
                const fsPath = validItem.resourceUri?.fsPath;
                if (!fsPath) {
                    continue;
                }

                let pathToCopy: string;
                if (absolute) {
                    // Use absolute path
                    pathToCopy = fsPath;
                } else {
                    // Calculate relative path from workspace root
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(validItem.resourceUri!);
                    if (workspaceFolder) {
                        pathToCopy = vscode.workspace.asRelativePath(validItem.resourceUri!, false);
                    } else {
                        // If not in workspace, use the path as-is
                        pathToCopy = fsPath;
                    }
                }
                paths.push(pathToCopy);
            }

            if (paths.length === 0) {
                NotificationManager.showError('Unable to get paths for selected items');
                return;
            }

            // Copy to clipboard (join with newlines for multiple paths)
            const pathsText = paths.join('\n');
            await vscode.env.clipboard.writeText(pathsText);

            // Show confirmation message
            const pathType = absolute ? 'Absolute' : 'Relative';
            const message = paths.length === 1
                ? `${pathType} path copied to clipboard: ${paths[0]}`
                : `${paths.length} ${pathType.toLowerCase()} paths copied to clipboard`;
            NotificationManager.showInfo(message, { timeout: 2000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error copying path', err);
            NotificationManager.showError(`Failed to copy path: ${err.message}`);
        }
    }


    /**
     * Create a new file in a logical group
     */
    private async createFileInLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get the filename
            const fileName = await vscode.window.showInputBox({
                prompt: 'Enter the name for the new file',
                placeHolder: 'filename.txt',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'File name cannot be empty';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return 'File name cannot contain path separators';
                    }
                    return null;
                }
            });

            if (!fileName) {
                return;
            }

            // Ask where to create the file
            const location = await vscode.window.showQuickPick(
                [
                    { label: 'Workspace Root', value: 'workspace' },
                    { label: 'Custom Location...', value: 'custom' }
                ],
                {
                    placeHolder: 'Where should the file be created?'
                }
            );

            if (!location) {
                return;
            }

            let targetPath: string;
            const fs = require('fs');

            if (location.value === 'custom') {
                // Show file save dialog (no filters needed - defaultUri includes filename)
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(getWorkspaceRoot() || '', fileName)),
                    saveLabel: 'Create File Here'
                });

                if (!uri) {
                    return;
                }

                targetPath = uri.fsPath;
            } else {
                // Create in workspace root
                const wsRoot = getWorkspaceRoot();
                if (!wsRoot) {
                    NotificationManager.showError('No workspace folder found');
                    return;
                }
                targetPath = path.join(wsRoot, fileName);
            }

            // Create the file if it doesn't exist
            if (fs.existsSync(targetPath)) {
                const overwrite = await NotificationManager.showWarning(
                    `File "${path.basename(targetPath)}" already exists. Do you want to add it to the group anyway?`,
                    { timeout: 0, actions: ['Yes'] }
                );
                if (overwrite !== 'Yes') {
                    return;
                }
            } else {
                // Create empty file
                fs.writeFileSync(targetPath, '', 'utf8');
            }

            // Add to logical group
            const configManager = this.treeDataProvider.getConfigurationManager();

            // Build the full group path for nested groups
            const groupPath = groupItem.parentGroupPath
                ? `${groupItem.parentGroupPath}/${groupItem.originalName}`
                : groupItem.originalName;

            await configManager.addToLogicalGroup(
                groupPath,
                targetPath,
                path.basename(targetPath),
                'file'
            );

            this.treeDataProvider.refresh();
            NotificationManager.showInfo(`File "${path.basename(targetPath)}" created and added to group!`, { timeout: 3000 });

            // Open the file in the editor
            const fileUri = vscode.Uri.file(targetPath);
            await this.openFile(fileUri);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error creating file in logical group', err);
            NotificationManager.showError(`Failed to create file: ${err.message}`);
        }
    }

    /**
     * Create a new file in a subfolder
     */
    private async createFileInFolder(folderItem: LogicalGroupChildItem | FolderShortcutItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            const parentFolder = folderItem.resourceUri.fsPath;

            // Verify the parent is actually a folder
            const fs = require('fs');
            const stat = fs.statSync(parentFolder);
            if (!stat.isDirectory()) {
                NotificationManager.showError('Selected item is not a folder');
                return;
            }

            // Get the filename
            const fileName = await vscode.window.showInputBox({
                prompt: `Enter the name for the new file in ${path.basename(parentFolder)}`,
                placeHolder: 'filename.txt',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'File name cannot be empty';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return 'File name cannot contain path separators';
                    }
                    return null;
                }
            });

            if (!fileName) {
                return;
            }

            const targetPath = path.join(parentFolder, fileName);

            // Create the file if it doesn't exist
            if (fs.existsSync(targetPath)) {
                const overwrite = await NotificationManager.showWarning(
                    `File "${fileName}" already exists. Do you want to open it anyway?`,
                    { timeout: 0, actions: ['Open'] }
                );
                if (overwrite !== 'Open') {
                    return;
                }
            } else {
                // Create empty file
                fs.writeFileSync(targetPath, '', 'utf8');
            }

            // If this is within a logical group, add to the group
            if (folderItem instanceof LogicalGroupChildItem) {
                const configManager = this.treeDataProvider.getConfigurationManager();
                await configManager.addToLogicalGroup(
                    folderItem.parentGroup,
                    targetPath,
                    fileName,
                    'file'
                );
                NotificationManager.showInfo(`File "${fileName}" created and added to group "${folderItem.parentGroup}"!`, { timeout: 3000 });
            } else {
                NotificationManager.showInfo(`File "${fileName}" created in ${path.basename(parentFolder)}!`, { timeout: 3000 });
            }

            this.treeDataProvider.refresh();

            // Open the file in the editor
            const fileUri = vscode.Uri.file(targetPath);
            await this.openFile(fileUri);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.FILESYSTEM, 'Error creating file in folder', err);
            NotificationManager.showError(`Failed to create file: ${err.message}`);
        }
    }

    /**
     * Create a new folder in a subfolder
     */
    private async createFolderInFolder(folderItem: LogicalGroupChildItem | FolderShortcutItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            const parentFolder = folderItem.resourceUri.fsPath;

            // Verify the parent is actually a folder
            const fs = require('fs');
            const stat = fs.statSync(parentFolder);
            if (!stat.isDirectory()) {
                NotificationManager.showError('Selected item is not a folder');
                return;
            }

            // Get the folder name
            const folderName = await vscode.window.showInputBox({
                prompt: `Enter the name for the new folder in ${path.basename(parentFolder)}`,
                placeHolder: 'folder-name',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Folder name cannot be empty';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return 'Folder name cannot contain path separators';
                    }
                    return null;
                }
            });

            if (!folderName) {
                return;
            }

            const targetPath = path.join(parentFolder, folderName);

            // Create the folder if it doesn't exist
            if (fs.existsSync(targetPath)) {
                const stat = fs.statSync(targetPath);
                if (!stat.isDirectory()) {
                    NotificationManager.showError(`A file with name "${folderName}" already exists at this location`);
                    return;
                }
                const addExisting = await NotificationManager.showWarning(
                    `Folder "${folderName}" already exists.`,
                    { timeout: 0, actions: ['OK'] }
                );
                if (addExisting !== 'OK') {
                    return;
                }
            } else {
                // Create the folder
                fs.mkdirSync(targetPath, { recursive: true });
            }

            // If this is within a logical group, add to the group
            if (folderItem instanceof LogicalGroupChildItem) {
                const configManager = this.treeDataProvider.getConfigurationManager();
                await configManager.addToLogicalGroup(
                    folderItem.parentGroup,
                    targetPath,
                    folderName,
                    'folder'
                );
                NotificationManager.showInfo(`Folder "${folderName}" created and added to group "${folderItem.parentGroup}"!`, { timeout: 3000 });
            } else {
                NotificationManager.showInfo(`Folder "${folderName}" created in ${path.basename(parentFolder)}!`, { timeout: 3000 });
            }

            this.treeDataProvider.refresh();

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.FILESYSTEM, 'Error creating folder in folder', err);
            NotificationManager.showError(`Failed to create folder: ${err.message}`);
        }
    }

    /**
     * Create a new folder in a logical group
     */
    private async createFolderInLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get the folder name
            const folderName = await vscode.window.showInputBox({
                prompt: 'Enter the name for the new folder',
                placeHolder: 'folder-name',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Folder name cannot be empty';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return 'Folder name cannot contain path separators';
                    }
                    return null;
                }
            });

            if (!folderName) {
                return;
            }

            // Ask where to create the folder
            const location = await vscode.window.showQuickPick(
                [
                    { label: 'Workspace Root', value: 'workspace' },
                    { label: 'Custom Location...', value: 'custom' }
                ],
                {
                    placeHolder: 'Where should the folder be created?'
                }
            );

            if (!location) {
                return;
            }

            let targetPath: string;
            const fs = require('fs');

            if (location.value === 'custom') {
                // Show folder selection dialog
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: 'Select Parent Folder',
                    title: 'Select where to create the new folder'
                });

                if (!uris || uris.length === 0) {
                    return;
                }

                targetPath = path.join(uris[0].fsPath, folderName);
            } else {
                // Create in workspace root
                const wsRoot = getWorkspaceRoot();
                if (!wsRoot) {
                    NotificationManager.showError('No workspace folder found');
                    return;
                }
                targetPath = path.join(wsRoot, folderName);
            }

            // Create the folder if it doesn't exist
            if (fs.existsSync(targetPath)) {
                const stat = fs.statSync(targetPath);
                if (!stat.isDirectory()) {
                    NotificationManager.showError(`A file with name "${folderName}" already exists at this location`);
                    return;
                }
                const addExisting = await NotificationManager.showWarning(
                    `Folder "${folderName}" already exists. Do you want to add it to the group anyway?`,
                    { timeout: 0, actions: ['Yes'] }
                );
                if (addExisting !== 'Yes') {
                    return;
                }
            } else {
                // Create the folder
                fs.mkdirSync(targetPath, { recursive: true });
            }

            // Add to logical group
            const configManager = this.treeDataProvider.getConfigurationManager();

            // Build the full group path for nested groups
            const groupPath = groupItem.parentGroupPath
                ? `${groupItem.parentGroupPath}/${groupItem.originalName}`
                : groupItem.originalName;

            await configManager.addToLogicalGroup(
                groupPath,
                targetPath,
                path.basename(targetPath),
                'folder'
            );

            this.treeDataProvider.refresh();
            NotificationManager.showInfo(`Folder "${path.basename(targetPath)}" created and added to group!`, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.CONFIG, 'Error creating folder in logical group', err);
            NotificationManager.showError(`Failed to create folder: ${err.message}`);
        }
    }

    /**
     * Reveal item in VS Code Explorer
     */
    private async revealInExplorer(item: LogicalGroupChildItem | FolderShortcutItem | FileShortcutItem): Promise<void> {
        try {
            if (!item.resourceUri) {
                NotificationManager.showError('Cannot reveal item: no resource URI');
                return;
            }

            // Use VS Code's built-in reveal in explorer command
            await vscode.commands.executeCommand('revealInExplorer', item.resourceUri);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error revealing in explorer', err);
            NotificationManager.showError(`Failed to reveal in explorer: ${err.message}`);
        }
    }

    /**
     * Open terminal at item location (for folders) or at parent folder (for files)
     */
    private async openInTerminal(item: LogicalGroupChildItem | FolderShortcutItem | FileShortcutItem): Promise<void> {
        try {
            if (!item.resourceUri) {
                NotificationManager.showError('Cannot open terminal: no resource URI');
                return;
            }

            const fs = require('fs');
            let terminalPath: string;

            // Determine the path to open terminal at
            const itemPath = item.resourceUri.fsPath;
            const stat = fs.statSync(itemPath);

            if (stat.isDirectory()) {
                // For folders, open terminal at the folder
                terminalPath = itemPath;
            } else {
                // For files, open terminal at the parent folder
                terminalPath = path.dirname(itemPath);
            }

            // Create a new terminal at the location
            const terminal = vscode.window.createTerminal({
                name: `Terminal - ${path.basename(terminalPath)}`,
                cwd: terminalPath
            });

            terminal.show();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error opening terminal', err);
            NotificationManager.showError(`Failed to open terminal: ${err.message}`);
        }
    }

    /**
     * Execute a command item
     */
    private async executeCommandItem(item: CommandShortcutItem): Promise<void> {
        try {
            if (!item.commandId) {
                NotificationManager.showError('Command item has no command ID');
                return;
            }

            // Execute the command with optional arguments
            if (item.commandArgs && item.commandArgs.length > 0) {
                await vscode.commands.executeCommand(item.commandId, ...item.commandArgs);
            } else {
                await vscode.commands.executeCommand(item.commandId);
            }

            NotificationManager.showInfo(`Executed command: ${item.label}`, { timeout: 2000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error executing command', err);
            NotificationManager.showError(`Failed to execute command "${item.label}": ${err.message}`);
        }
    }

    /**
     * Execute a task item
     */
    private async executeTaskItem(item: TaskShortcutItem): Promise<void> {
        try {
            if (!item.taskName) {
                NotificationManager.showError('Task item has no task name');
                return;
            }

            // Fetch all tasks
            const tasks = await vscode.tasks.fetchTasks();

            // Find the task by name
            const task = tasks.find(t => t.name === item.taskName);

            if (!task) {
                NotificationManager.showError(`Task "${item.taskName}" not found. Make sure it's defined in tasks.json.`);
                return;
            }

            // Execute the task
            await vscode.tasks.executeTask(task);
            NotificationManager.showInfo(`Running task: ${item.label}`, { timeout: 2000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.TASKS, 'Error executing task', err);
            NotificationManager.showError(`Failed to execute task "${item.label}": ${err.message}`);
        }
    }

    /**
     * Configure cloud sync
     */
    private async configureSyncCommand(): Promise<void> {
        try {
            const settingsConfig = vscode.workspace.getConfiguration('workspaceShortcuts.sync');

            // Configure VSCode sync scope
            const scope = await vscode.window.showQuickPick(
                [
                    { label: 'Global', value: 'global', description: 'Sync across all workspaces' },
                    { label: 'Workspace', value: 'workspace', description: 'Sync only within this workspace' }
                ],
                { placeHolder: 'Select VSCode sync scope' }
            );

            if (!scope) {
                return;
            }

            await settingsConfig.update('provider', 'vscode', vscode.ConfigurationTarget.Global);
            await settingsConfig.update('vscode.scope', scope.value, vscode.ConfigurationTarget.Global);
            NotificationManager.showInfo('VSCode Settings Sync configured successfully');

            // Ask if user wants to enable sync now
            const enable = await vscode.window.showQuickPick(
                ['Yes', 'No'],
                { placeHolder: 'Enable cloud sync now?' }
            );

            if (enable === 'Yes') {
                await this.enableSyncCommand();
            } else {
                NotificationManager.showInfo('Cloud sync configured but not enabled. Use "Enable Cloud Sync" command to enable.');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.SYNC, 'Error configuring sync', err);
            NotificationManager.showError(`Failed to configure sync: ${err.message}`);
        }
    }

    /**
     * Enable cloud sync
     */
    private async enableSyncCommand(): Promise<void> {
        try {
            const settingsConfig = vscode.workspace.getConfiguration('workspaceShortcuts.sync');
            const provider = settingsConfig.get<string>('provider');

            if (!provider) {
                NotificationManager.showWarning('Cloud sync is not configured. Please configure it first.');
                const configure = await vscode.window.showQuickPick(
                    ['Configure Now', 'Cancel'],
                    { placeHolder: 'Would you like to configure cloud sync?' }
                );
                if (configure === 'Configure Now') {
                    await this.configureSyncCommand();
                }
                return;
            }

            // Enable sync
            await settingsConfig.update('enabled', true, vscode.ConfigurationTarget.Global);

            // Reinitialize sync manager
            await this.treeDataProvider.getConfigurationManager().reinitializeSyncManager();

            NotificationManager.showInfo('Cloud sync enabled');
            this.refreshShortcuts();

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.SYNC, 'Error enabling sync', err);
            NotificationManager.showError(`Failed to enable sync: ${err.message}`);
        }
    }

    /**
     * Disable cloud sync
     */
    private async disableSyncCommand(): Promise<void> {
        try {
            const settingsConfig = vscode.workspace.getConfiguration('workspaceShortcuts.sync');

            // Disable sync
            await settingsConfig.update('enabled', false, vscode.ConfigurationTarget.Global);

            // Reinitialize sync manager (will dispose it)
            await this.treeDataProvider.getConfigurationManager().reinitializeSyncManager();

            NotificationManager.showInfo('Cloud sync disabled');
            this.refreshShortcuts();

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.SYNC, 'Error disabling sync', err);
            NotificationManager.showError(`Failed to disable sync: ${err.message}`);
        }
    }

    /**
     * Manually trigger sync now
     */
    private async syncNowCommand(): Promise<void> {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Syncing configuration...',
                    cancellable: false
                },
                async () => {
                    await this.treeDataProvider.getConfigurationManager().syncToCloud();
                    await this.treeDataProvider.getConfigurationManager().syncFromCloud();
                }
            );

            this.refreshShortcuts();

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.SYNC, 'Error syncing', err);
            NotificationManager.showError(`Failed to sync: ${err.message}`);
        }
    }

    /**
     * Show sync status
     */
    private async syncStatusCommand(): Promise<void> {
        try {
            const status = await this.treeDataProvider.getConfigurationManager().getSyncStatus();

            vscode.window.showInformationMessage(
                'Cloud Sync Status',
                { modal: true, detail: status }
            );

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.SYNC, 'Error getting sync status', err);
            NotificationManager.showError(`Failed to get sync status: ${err.message}`);
        }
    }

    /**
     * Create a new note in a logical group
     */
    private async createNote(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get the note name
            const noteName = await vscode.window.showInputBox({
                prompt: 'Enter a name for the new note',
                placeHolder: 'Note name',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Note name cannot be empty';
                    }
                    return null;
                }
            });

            if (!noteName) {
                return;
            }

            // Build the full group path for nested groups
            const groupPath = groupItem.parentGroupPath
                ? `${groupItem.parentGroupPath}/${groupItem.originalName}`
                : groupItem.originalName;

            // Create the note
            const configManager = this.treeDataProvider.getConfigurationManager();
            const noteId = await configManager.createNote(groupPath, noteName.trim());

            this.treeDataProvider.refresh();
            NotificationManager.showInfo(`Note "${noteName}" created successfully!`, { timeout: 3000 });

            // Open the note in the editor if noteDocumentManager is available
            if (this.noteDocumentManager) {
                await this.noteDocumentManager.openNote(noteId, noteName.trim());
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error creating note', err);
            NotificationManager.showError(`Failed to create note: ${err.message}`);
        }
    }

    /**
     * Open a note for editing
     */
    private async editNote(noteItem: NoteShortcutItem): Promise<void> {
        try {
            if (!this.noteDocumentManager) {
                NotificationManager.showError('Note editor is not available');
                return;
            }

            // Open the note in the editor
            await this.noteDocumentManager.openNote(noteItem.noteId, noteItem.label as string);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error editing note', err);
            NotificationManager.showError(`Failed to open note: ${err.message}`);
        }
    }

    /**
     * Delete a note from a logical group
     */
    private async deleteNote(noteItem: NoteShortcutItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Confirm deletion
            const confirmation = await NotificationManager.showWarning(
                `Are you sure you want to delete the note "${noteItem.label}"? This cannot be undone.`,
                { timeout: 0, actions: ['Delete'] }
            );

            if (confirmation !== 'Delete') {
                return;
            }

            // Delete the note
            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.deleteNote(noteItem.parentGroup, noteItem.noteId);

            this.treeDataProvider.refresh();
            NotificationManager.showInfo(`Note "${noteItem.label}" deleted successfully!`, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error deleting note', err);
            NotificationManager.showError(`Failed to delete note: ${err.message}`);
        }
    }

    /**
     * Rename a note
     */
    private async renameNote(noteItem: NoteShortcutItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get the new name
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter a new name for the note',
                placeHolder: 'Note name',
                value: noteItem.label as string,
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Note name cannot be empty';
                    }
                    return null;
                }
            });

            if (!newName || newName.trim() === noteItem.label) {
                return;
            }

            // Update the note name in configuration
            const configManager = this.treeDataProvider.getConfigurationManager();
            const config = await configManager.loadConfiguration();

            // Find the note item in the configuration and update its name
            let found = false;
            const updateNoteName = (groups: any[]): boolean => {
                for (const group of groups) {
                    // Check items in this group
                    for (const item of group.items) {
                        if (item.type === 'note' && item.noteId === noteItem.noteId) {
                            item.name = newName.trim();
                            found = true;
                            return true;
                        }
                    }
                    // Check nested groups
                    if (group.groups && Array.isArray(group.groups)) {
                        if (updateNoteName(group.groups)) {
                            return true;
                        }
                    }
                }
                return false;
            };

            if (config.logicalGroups) {
                updateNoteName(config.logicalGroups);
            }

            if (!found) {
                NotificationManager.showError('Note not found in configuration');
                return;
            }

            await configManager.saveConfiguration(config);

            this.treeDataProvider.refresh();
            NotificationManager.showInfo(`Note renamed to "${newName}" successfully!`, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error renaming note', err);
            NotificationManager.showError(`Failed to rename note: ${err.message}`);
        }
    }

    /**
     * Create a new global note (not tied to any group)
     */
    private async createGlobalNote(): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get the note name
            const noteName = await vscode.window.showInputBox({
                prompt: 'Enter a name for the new global note',
                placeHolder: 'Note name',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Note name cannot be empty';
                    }
                    return null;
                }
            });

            if (!noteName) {
                return;
            }

            // Create the global note
            const configManager = this.treeDataProvider.getConfigurationManager();
            const noteId = await configManager.createGlobalNote(noteName.trim());

            this.globalNotesTreeDataProvider?.refresh();
            NotificationManager.showInfo(`Global note "${noteName}" created successfully!`, { timeout: 3000 });

            // Open the note in the editor if noteDocumentManager is available
            if (this.noteDocumentManager) {
                await this.noteDocumentManager.openNote(noteId, noteName.trim());
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error creating global note', err);
            NotificationManager.showError(`Failed to create global note: ${err.message}`);
        }
    }

    /**
     * Open a global note for editing
     */
    private async editGlobalNote(noteItem: GlobalNoteItem): Promise<void> {
        try {
            if (!this.noteDocumentManager) {
                NotificationManager.showError('Note editor is not available');
                return;
            }

            // Open the note in the editor
            await this.noteDocumentManager.openNote(noteItem.noteId, noteItem.label as string);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error editing global note', err);
            NotificationManager.showError(`Failed to open note: ${err.message}`);
        }
    }

    /**
     * Delete a global note
     */
    private async deleteGlobalNote(noteItem: GlobalNoteItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Confirm deletion
            const confirmation = await NotificationManager.showWarning(
                `Are you sure you want to delete the global note "${noteItem.label}"? This cannot be undone.`,
                { timeout: 0, actions: ['Delete'] }
            );

            if (confirmation !== 'Delete') {
                return;
            }

            // Delete the global note
            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.deleteGlobalNote(noteItem.noteId);

            this.globalNotesTreeDataProvider?.refresh();
            NotificationManager.showInfo(`Global note "${noteItem.label}" deleted successfully!`, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error deleting global note', err);
            NotificationManager.showError(`Failed to delete global note: ${err.message}`);
        }
    }

    /**
     * Rename a global note
     */
    private async renameGlobalNote(noteItem: GlobalNoteItem): Promise<void> {
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get the new name
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter a new name for the global note',
                placeHolder: 'Note name',
                value: noteItem.label as string,
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Note name cannot be empty';
                    }
                    return null;
                }
            });

            if (!newName || newName.trim() === noteItem.label) {
                return;
            }

            // Update the global note name
            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.renameGlobalNote(noteItem.noteId, newName.trim());

            this.globalNotesTreeDataProvider?.refresh();
            NotificationManager.showInfo(`Global note renamed to "${newName}" successfully!`, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            getExtensionLogger().error(LogCategory.EXTENSION, 'Error renaming global note', err);
            NotificationManager.showError(`Failed to rename global note: ${err.message}`);
        }
    }

}
