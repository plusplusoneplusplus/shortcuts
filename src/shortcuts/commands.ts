import * as vscode from 'vscode';
import * as path from 'path';
import { ShortcutsTreeDataProvider } from './tree-data-provider';
import { LogicalTreeDataProvider } from './logical-tree-data-provider';
import { FolderShortcutItem, FileShortcutItem, LogicalGroupItem, LogicalGroupChildItem } from './tree-items';
import { LogicalGroup } from './types';
import { NotificationManager } from './notification-manager';
import { InlineSearchProvider } from './inline-search-provider';

/**
 * Command handlers for the shortcuts panel
 */
export class ShortcutsCommands {
    constructor(
        private physicalTreeDataProvider: ShortcutsTreeDataProvider,
        private logicalTreeDataProvider?: LogicalTreeDataProvider,
        private updateSearchDescriptions?: () => void,
        private unifiedSearchProvider?: InlineSearchProvider
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
     * Remove a shortcut
     * @param item The folder item to remove
     */
    private async removeShortcut(item: FolderShortcutItem): Promise<void> {
        try {
            // Confirm removal
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to remove the shortcut "${item.displayName}"?`,
                { modal: true },
                'Remove'
            );

            if (confirmation !== 'Remove') {
                return; // User cancelled
            }

            // Remove the shortcut using configuration manager
            const configManager = this.physicalTreeDataProvider.getConfigurationManager();
            await configManager.removeShortcut(item.fsPath);

            // Refresh the tree view
            this.physicalTreeDataProvider.refresh();

            NotificationManager.showInfo('Shortcut removed successfully!', { timeout: 3000 });

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
                openLabel: 'Add to Group'
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
                NotificationManager.showInfo(`${addedCount} ${itemText} added to logical group successfully!`, { timeout: 3000 });
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
     * Remove an item from a logical group
     */
    private async removeFromLogicalGroup(item: LogicalGroupChildItem): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            return;
        }

        try {
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to remove "${item.label}" from the group "${item.parentGroup}"?`,
                { modal: true },
                'Remove'
            );

            if (confirmation !== 'Remove') {
                return;
            }

            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
            await configManager.removeFromLogicalGroup(item.parentGroup, item.fsPath);

            this.logicalTreeDataProvider.refresh();
            NotificationManager.showInfo('Item removed from logical group successfully!', { timeout: 3000 });

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
     * Delete a logical group
     */
    private async deleteLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            return;
        }

        try {
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to delete the logical group "${groupItem.label}"? This will remove all items from the group.`,
                { modal: true },
                'Delete'
            );

            if (confirmation !== 'Delete') {
                return;
            }

            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
            await configManager.deleteLogicalGroup(groupItem.label);

            this.logicalTreeDataProvider.refresh();
            NotificationManager.showInfo('Logical group deleted successfully!', { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error deleting logical group:', err);
            vscode.window.showErrorMessage(`Failed to delete logical group: ${err.message}`);
        }
    }

    /**
     * Copy the path of an item to clipboard
     * @param item The tree item to copy the path from
     * @param absolute Whether to copy absolute or relative path
     */
    private async copyPath(item: FolderShortcutItem | FileShortcutItem | LogicalGroupChildItem, absolute: boolean): Promise<void> {
        try {
            let pathToCopy: string;

            // Get the file system path from the item
            const fsPath = item.resourceUri?.fsPath;
            if (!fsPath) {
                vscode.window.showErrorMessage('Unable to get path for this item');
                return;
            }

            if (absolute) {
                // Use absolute path
                pathToCopy = fsPath;
            } else {
                // Calculate relative path from workspace root
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(item.resourceUri!);
                if (workspaceFolder) {
                    pathToCopy = vscode.workspace.asRelativePath(item.resourceUri!, false);
                } else {
                    // If not in workspace, use the path as-is
                    pathToCopy = fsPath;
                }
            }

            // Copy to clipboard
            await vscode.env.clipboard.writeText(pathToCopy);

            // Show confirmation message
            const pathType = absolute ? 'Absolute' : 'Relative';
            NotificationManager.showInfo(`${pathType} path copied to clipboard: ${pathToCopy}`, { timeout: 2000 });

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
     * Add an item (file or folder) from Physical Folders to a logical group
     */
    private async addItemToLogicalGroup(item: FileShortcutItem | FolderShortcutItem, itemType: 'file' | 'folder'): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            vscode.window.showErrorMessage('Logical groups are not available');
            return;
        }

        try {
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

            const selectedGroupItem = await vscode.window.showQuickPick(groupItems, {
                placeHolder: `Select logical group to add ${itemType} to`,
                title: `Add ${itemType} to Logical Group`
            });

            if (!selectedGroupItem) {
                return; // User cancelled
            }

            const configManager = this.logicalTreeDataProvider.getConfigurationManager();

            // Use the filename as the default display name
            const defaultName = path.basename(item.resourceUri.fsPath);

            await configManager.addToLogicalGroup(
                selectedGroupItem.group.name,
                item.resourceUri.fsPath,
                defaultName,
                itemType
            );

            // Refresh the logical tree view
            this.logicalTreeDataProvider.refresh();

            NotificationManager.showInfo(
                `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} "${defaultName}" added to group "${selectedGroupItem.group.name}"`,
                { timeout: 3000 }
            );

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error(`Error adding ${itemType} to logical group:`, err);
            vscode.window.showErrorMessage(`Failed to add ${itemType} to group: ${err.message}`);
        }
    }



}