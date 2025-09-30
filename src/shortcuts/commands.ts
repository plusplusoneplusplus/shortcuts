import * as path from 'path';
import * as vscode from 'vscode';
import { InlineSearchProvider } from './inline-search-provider';
import { LogicalTreeDataProvider } from './logical-tree-data-provider';
import { NotificationManager } from './notification-manager';
import { ShortcutsTreeDataProvider } from './tree-data-provider';
import { FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem } from './tree-items';

/**
 * Command handlers for the shortcuts panel
 */
export class ShortcutsCommands {
    constructor(
        private physicalTreeDataProvider: ShortcutsTreeDataProvider,
        private logicalTreeDataProvider?: LogicalTreeDataProvider,
        private updateSearchDescriptions?: () => void,
        private unifiedSearchProvider?: InlineSearchProvider,
        private physicalTreeView?: vscode.TreeView<any>,
        private logicalTreeView?: vscode.TreeView<any>
    ) { }

    /**
     * Register all command handlers
     * @param context Extension context for registering disposables
     * @returns Array of disposables for cleanup
     */
    registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];

        // Add folder shortcut command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.addFolder', async () => {
                await this.addFolderShortcut();
            })
        );

        // Remove shortcut command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.removeShortcut', async (item: FolderShortcutItem) => {
                await this.removeShortcut(item);
            })
        );

        // Rename shortcut command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.renameShortcut', async (item: FolderShortcutItem) => {
                await this.renameShortcut(item);
            })
        );

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

        // Logical group management commands
        if (this.logicalTreeDataProvider) {
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

            disposables.push(
                vscode.commands.registerCommand('shortcuts.removeFromLogicalGroup', async (item: LogicalGroupChildItem) => {
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
        }

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

        // Unified search commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.clearSearch', () => {
                this.clearUnifiedSearch();
            })
        );

        // Add file to logical group command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.addFileToLogicalGroup', async (item: FileShortcutItem) => {
                await this.addItemToLogicalGroup(item, 'file');
            })
        );

        // Add folder to logical group command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.addFolderToLogicalGroup', async (item: FolderShortcutItem) => {
                await this.addItemToLogicalGroup(item, 'folder');
            })
        );

        // Search input commands
        disposables.push(
            vscode.commands.registerCommand('shortcuts.editSearchInput', () => {
                this.editSearchInput();
            })
        );

        disposables.push(
            vscode.commands.registerCommand('shortcuts.clearSearchFromItem', () => {
                this.clearSearchFromItem();
            })
        );

        return disposables;
    }

    /**
     * Add a new folder shortcut
     */
    private async addFolderShortcut(): Promise<void> {
        let selectedFolder: vscode.Uri | undefined;

        try {
            // Open folder picker dialog
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Add Folder Shortcut'
            });

            if (!folderUri || folderUri.length === 0) {
                return; // User cancelled
            }

            selectedFolder = folderUri[0];

            // Ask for optional display name
            const displayName = await vscode.window.showInputBox({
                prompt: 'Enter a display name for this shortcut (optional)',
                placeHolder: 'Leave empty to use folder name',
                value: ''
            });

            // Add the shortcut using configuration manager
            const configManager = this.physicalTreeDataProvider.getConfigurationManager();
            await configManager.addShortcut(
                selectedFolder.fsPath,
                displayName || undefined
            );

            // Refresh the tree view
            this.physicalTreeDataProvider.refresh();

            NotificationManager.showInfo('Folder shortcut added successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error adding folder shortcut:', err);
            vscode.window.showErrorMessage(`Failed to add folder shortcut: ${err.message}`);
        }
    }

    /**
     * Remove a shortcut (supports multi-selection)
     * @param item The folder item to remove
     */
    private async removeShortcut(item: FolderShortcutItem): Promise<void> {
        try {
            // Get all selected items from the tree view
            const selectedItems = this.physicalTreeView?.selection || [item];
            const folderItems = selectedItems.filter(i => i instanceof FolderShortcutItem) as FolderShortcutItem[];

            if (folderItems.length === 0) {
                return;
            }

            // Confirm removal
            const message = folderItems.length === 1
                ? `Are you sure you want to remove the shortcut "${folderItems[0].displayName}"?`
                : `Are you sure you want to remove ${folderItems.length} shortcuts?`;

            const confirmation = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Remove'
            );

            if (confirmation !== 'Remove') {
                return; // User cancelled
            }

            // Remove all selected shortcuts
            const configManager = this.physicalTreeDataProvider.getConfigurationManager();
            for (const folderItem of folderItems) {
                await configManager.removeShortcut(folderItem.fsPath);
            }

            // Refresh the tree view
            this.physicalTreeDataProvider.refresh();

            const successMessage = folderItems.length === 1
                ? 'Shortcut removed successfully!'
                : `${folderItems.length} shortcuts removed successfully!`;
            NotificationManager.showInfo(successMessage, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error removing shortcut:', err);
            vscode.window.showErrorMessage(`Failed to remove shortcut: ${err.message}`);
        }
    }

    /**
     * Rename a shortcut
     * @param item The folder item to rename
     */
    private async renameShortcut(item: FolderShortcutItem): Promise<void> {
        try {
            // Ask for new name
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter a new display name for this shortcut',
                placeHolder: 'Shortcut display name',
                value: item.displayName
            });

            if (!newName || newName.trim() === '') {
                return; // User cancelled or entered empty name
            }

            // Rename the shortcut using configuration manager
            const configManager = this.physicalTreeDataProvider.getConfigurationManager();
            await configManager.renameShortcut(item.fsPath, newName.trim());

            // Refresh the tree view
            this.physicalTreeDataProvider.refresh();

            NotificationManager.showInfo('Shortcut renamed successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error renaming shortcut:', err);
            vscode.window.showErrorMessage(`Failed to rename shortcut: ${err.message}`);
        }
    }

    /**
     * Refresh the shortcuts tree view
     */
    private refreshShortcuts(): void {
        this.physicalTreeDataProvider.refresh();
        if (this.logicalTreeDataProvider) {
            this.logicalTreeDataProvider.refresh();
        }
        NotificationManager.showInfo('Shortcuts refreshed!', { timeout: 2000 });
    }

    /**
     * Reset configuration to default
     */
    private async resetConfiguration(): Promise<void> {
        try {
            // Confirm reset
            const confirmation = await vscode.window.showWarningMessage(
                'Are you sure you want to reset the shortcuts configuration? This will remove all existing shortcuts.',
                { modal: true },
                'Reset'
            );

            if (confirmation !== 'Reset') {
                return; // User cancelled
            }

            // Reset using configuration manager
            const configManager = this.physicalTreeDataProvider.getConfigurationManager();
            const { DEFAULT_SHORTCUTS_CONFIG } = await import('./types');
            await configManager.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);

            // Refresh the tree view
            this.physicalTreeDataProvider.refresh();
            if (this.logicalTreeDataProvider) {
                this.logicalTreeDataProvider.refresh();
            }

            NotificationManager.showInfo('Configuration reset to default successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error resetting configuration:', err);
            vscode.window.showErrorMessage(`Failed to reset configuration: ${err.message}`);
        }
    }

    /**
     * Open the configuration file in the editor
     */
    private async openConfiguration(): Promise<void> {
        try {
            const configManager = this.physicalTreeDataProvider.getConfigurationManager();
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
            console.error('Error opening configuration file:', err);
            vscode.window.showErrorMessage(`Failed to open configuration file: ${err.message}`);
        }
    }

    /**
     * Create a new logical group
     */
    private async createLogicalGroup(): Promise<void> {
        if (!this.logicalTreeDataProvider) {
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

            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
            await configManager.createLogicalGroup(groupName.trim(), description?.trim());

            this.logicalTreeDataProvider.refresh();
            NotificationManager.showInfo('Logical group created successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error creating logical group:', err);
            vscode.window.showErrorMessage(`Failed to create logical group: ${err.message}`);
        }
    }

    /**
     * Add folders or files to a logical group (supports multi-select)
     */
    private async addToLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            return;
        }

        try {
            // Allow selection of both files and folders, and enable multi-select
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: true,
                openLabel: 'Add Files and Folders to Group',
                title: `Select files and folders to add to "${groupItem.label}"`,
                filters: {
                    'All Files': ['*']
                }
            });

            if (!uris || uris.length === 0) {
                return;
            }

            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
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

                    await configManager.addToLogicalGroup(
                        groupItem.originalName,
                        uri.fsPath,
                        defaultName,
                        itemType
                    );

                    addedCount++;
                } catch (error) {
                    console.warn(`Failed to add ${uri.fsPath}:`, error);
                    skippedCount++;
                }
            }

            this.logicalTreeDataProvider.refresh();

            // Show appropriate success message based on results
            if (addedCount > 0 && skippedCount === 0) {
                const itemText = addedCount === 1 ? 'item' : 'items';
                NotificationManager.showInfo(`${addedCount} ${itemText} added to group "${groupItem.label}" successfully!`, { timeout: 3000 });
            } else if (addedCount > 0 && skippedCount > 0) {
                vscode.window.showWarningMessage(`${addedCount} items added successfully, ${skippedCount} items skipped (may already exist in group).`);
            } else {
                vscode.window.showWarningMessage('No items were added. They may already exist in the group.');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error adding to logical group:', err);
            vscode.window.showErrorMessage(`Failed to add to logical group: ${err.message}`);
        }
    }

    /**
     * Remove an item from a logical group (supports multi-selection)
     */
    private async removeFromLogicalGroup(item: LogicalGroupChildItem): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            return;
        }

        try {
            // Get all selected items from the tree view
            const selectedItems = this.logicalTreeView?.selection || [item];
            const groupChildItems = selectedItems.filter(i => i instanceof LogicalGroupChildItem) as LogicalGroupChildItem[];

            if (groupChildItems.length === 0) {
                return;
            }

            // Confirm removal
            const message = groupChildItems.length === 1
                ? `Are you sure you want to remove "${groupChildItems[0].label}" from the group "${groupChildItems[0].parentGroup}"?`
                : `Are you sure you want to remove ${groupChildItems.length} items from their groups?`;

            const confirmation = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Remove'
            );

            if (confirmation !== 'Remove') {
                return;
            }

            // Remove all selected items
            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
            for (const childItem of groupChildItems) {
                await configManager.removeFromLogicalGroup(childItem.parentGroup, childItem.fsPath);
            }

            this.logicalTreeDataProvider.refresh();

            const successMessage = groupChildItems.length === 1
                ? 'Item removed from logical group successfully!'
                : `${groupChildItems.length} items removed from groups successfully!`;
            NotificationManager.showInfo(successMessage, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error removing from logical group:', err);
            vscode.window.showErrorMessage(`Failed to remove from logical group: ${err.message}`);
        }
    }

    /**
     * Rename a logical group
     */
    private async renameLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            return;
        }

        try {
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter a new name for the logical group',
                placeHolder: 'Group name',
                value: groupItem.label,
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Group name cannot be empty';
                    }
                    return null;
                }
            });

            if (!newName || newName.trim() === groupItem.label) {
                return;
            }

            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
            await configManager.renameLogicalGroup(groupItem.label, newName.trim());

            this.logicalTreeDataProvider.refresh();
            NotificationManager.showInfo('Logical group renamed successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error renaming logical group:', err);
            vscode.window.showErrorMessage(`Failed to rename logical group: ${err.message}`);
        }
    }

    /**
     * Delete a logical group (supports multi-selection)
     */
    private async deleteLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            return;
        }

        try {
            // Get all selected items from the tree view
            const selectedItems = this.logicalTreeView?.selection || [groupItem];
            const groupItems = selectedItems.filter(i => i instanceof LogicalGroupItem) as LogicalGroupItem[];

            if (groupItems.length === 0) {
                return;
            }

            // Confirm deletion
            const message = groupItems.length === 1
                ? `Are you sure you want to delete the logical group "${groupItems[0].label}"? This will remove all items from the group.`
                : `Are you sure you want to delete ${groupItems.length} logical groups? This will remove all items from these groups.`;

            const confirmation = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Delete'
            );

            if (confirmation !== 'Delete') {
                return;
            }

            // Delete all selected groups
            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
            for (const group of groupItems) {
                await configManager.deleteLogicalGroup(group.label);
            }

            this.logicalTreeDataProvider.refresh();

            const successMessage = groupItems.length === 1
                ? 'Logical group deleted successfully!'
                : `${groupItems.length} logical groups deleted successfully!`;
            NotificationManager.showInfo(successMessage, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error deleting logical group:', err);
            vscode.window.showErrorMessage(`Failed to delete logical group: ${err.message}`);
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
            const treeView = item instanceof LogicalGroupChildItem ? this.logicalTreeView : this.physicalTreeView;
            const selectedItems = treeView?.selection || [item];

            // Filter items that have valid paths
            const validItems = selectedItems.filter(i =>
                i instanceof FolderShortcutItem ||
                i instanceof FileShortcutItem ||
                i instanceof LogicalGroupChildItem
            ) as (FolderShortcutItem | FileShortcutItem | LogicalGroupChildItem)[];

            if (validItems.length === 0) {
                vscode.window.showErrorMessage('No valid items selected');
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
                vscode.window.showErrorMessage('Unable to get paths for selected items');
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
            console.error('Error copying path:', err);
            vscode.window.showErrorMessage(`Failed to copy path: ${err.message}`);
        }
    }

    /**
     * Clear unified search filter
     */
    private clearUnifiedSearch(): void {
        try {
            // Clear both tree providers
            this.physicalTreeDataProvider.clearSearchFilter();
            if (this.logicalTreeDataProvider) {
                this.logicalTreeDataProvider.clearSearchFilter();
            }

            // Clear the unified search input
            if (this.unifiedSearchProvider) {
                this.unifiedSearchProvider.updateSearchValue('');
            }

            this.updateSearchDescriptions?.();
            NotificationManager.showInfo('Search cleared', { timeout: 2000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error clearing search:', err);
            vscode.window.showErrorMessage(`Failed to clear search: ${err.message}`);
        }
    }

    /**
     * Add an item (file or folder) from Physical Folders to a logical group (supports multi-selection)
     */
    private async addItemToLogicalGroup(item: FileShortcutItem | FolderShortcutItem, itemType: 'file' | 'folder'): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            vscode.window.showErrorMessage('Logical groups are not available');
            return;
        }

        try {
            // Get all selected items from the tree view
            const selectedItems = this.physicalTreeView?.selection || [item];
            const validItems = selectedItems.filter(i => {
                if (itemType === 'file') {
                    return i instanceof FileShortcutItem;
                } else {
                    return i instanceof FolderShortcutItem;
                }
            }) as (FileShortcutItem | FolderShortcutItem)[];

            if (validItems.length === 0) {
                return;
            }

            // Get all available logical groups
            const groups = await this.logicalTreeDataProvider.getLogicalGroups();

            if (groups.length === 0) {
                const createAction = await vscode.window.showInformationMessage(
                    'No logical groups exist. Would you like to create one?',
                    'Create Group',
                    'Cancel'
                );

                if (createAction === 'Create Group') {
                    await this.createLogicalGroup();
                    // After creating, try again
                    return this.addItemToLogicalGroup(item, itemType);
                }
                return;
            }

            // Show quick pick to select the group
            const groupItems = groups.map(group => ({
                label: group.name,
                description: group.description || '',
                group: group
            }));

            const itemTypeText = validItems.length === 1 ? itemType : `${itemType}s`;
            const selectedGroupItem = await vscode.window.showQuickPick(groupItems, {
                placeHolder: validItems.length === 1
                    ? `Select logical group to add ${itemType} to`
                    : `Select logical group to add ${validItems.length} ${itemTypeText} to`,
                title: `Add ${itemTypeText} to Logical Group`
            });

            if (!selectedGroupItem) {
                return; // User cancelled
            }

            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
            let addedCount = 0;
            let skippedCount = 0;

            // Add all selected items
            for (const validItem of validItems) {
                try {
                    const defaultName = path.basename(validItem.resourceUri.fsPath);
                    await configManager.addToLogicalGroup(
                        selectedGroupItem.group.name,
                        validItem.resourceUri.fsPath,
                        defaultName,
                        itemType
                    );
                    addedCount++;
                } catch (error) {
                    console.warn(`Failed to add ${validItem.resourceUri.fsPath}:`, error);
                    skippedCount++;
                }
            }

            // Refresh the logical tree view
            this.logicalTreeDataProvider.refresh();

            // Show appropriate success message
            if (addedCount > 0 && skippedCount === 0) {
                const message = addedCount === 1
                    ? `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} added to group "${selectedGroupItem.group.name}"`
                    : `${addedCount} ${itemTypeText} added to group "${selectedGroupItem.group.name}"`;
                NotificationManager.showInfo(message, { timeout: 3000 });
            } else if (addedCount > 0 && skippedCount > 0) {
                vscode.window.showWarningMessage(`${addedCount} items added successfully, ${skippedCount} items skipped (may already exist in group).`);
            } else {
                vscode.window.showWarningMessage('No items were added. They may already exist in the group.');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error(`Error adding ${itemType} to logical group:`, err);
            vscode.window.showErrorMessage(`Failed to add ${itemType} to group: ${err.message}`);
        }
    }

    /**
     * Edit/focus the search input
     */
    private editSearchInput(): void {
        try {
            if (this.unifiedSearchProvider) {
                this.unifiedSearchProvider.focusSearchInput();
            } else {
                vscode.window.showInformationMessage('Search functionality is not available');
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error focusing search input:', err);
            vscode.window.showErrorMessage(`Failed to focus search input: ${err.message}`);
        }
    }

    /**
     * Clear search from item context menu
     */
    private clearSearchFromItem(): void {
        try {
            // Clear both tree providers
            this.physicalTreeDataProvider.clearSearchFilter();
            if (this.logicalTreeDataProvider) {
                this.logicalTreeDataProvider.clearSearchFilter();
            }

            // Clear the unified search input
            if (this.unifiedSearchProvider) {
                this.unifiedSearchProvider.updateSearchValue('');
            }

            this.updateSearchDescriptions?.();
            NotificationManager.showInfo('Search cleared', { timeout: 2000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error clearing search from item:', err);
            vscode.window.showErrorMessage(`Failed to clear search: ${err.message}`);
        }
    }

}