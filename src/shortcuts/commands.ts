import * as path from 'path';
import * as vscode from 'vscode';
import { InlineSearchProvider } from './inline-search-provider';
import { LogicalTreeDataProvider } from './logical-tree-data-provider';
import { NotificationManager } from './notification-manager';
import { FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem } from './tree-items';

/**
 * Command handlers for the shortcuts panel
 */
export class ShortcutsCommands {
    constructor(
        private treeDataProvider: LogicalTreeDataProvider,
        private updateSearchDescriptions?: () => void,
        private unifiedSearchProvider?: InlineSearchProvider,
        private treeView?: vscode.TreeView<any>
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
            const configManager = this.treeDataProvider.getConfigurationManager();
            const { DEFAULT_SHORTCUTS_CONFIG } = await import('./types');
            await configManager.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);

            // Refresh the tree view
            this.treeDataProvider.refresh();

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
            console.error('Error opening configuration file:', err);
            vscode.window.showErrorMessage(`Failed to open configuration file: ${err.message}`);
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
            console.error('Error creating logical group:', err);
            vscode.window.showErrorMessage(`Failed to create logical group: ${err.message}`);
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
            // Allow selection of both files and folders, and enable multi-select
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: true,
                openLabel: 'Add Files and Folders to Group',
                title: `Select files and folders to add to "${groupItem.label}"`
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

            this.treeDataProvider.refresh();

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
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get all selected items from the tree view
            const selectedItems = this.treeView?.selection || [item];
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
            const configManager = this.treeDataProvider.getConfigurationManager();
            for (const childItem of groupChildItems) {
                await configManager.removeFromLogicalGroup(childItem.parentGroup, childItem.fsPath);
            }

            this.treeDataProvider.refresh();

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
        if (!this.treeDataProvider) {
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

            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.renameLogicalGroup(groupItem.label, newName.trim());

            this.treeDataProvider.refresh();
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
        if (!this.treeDataProvider) {
            return;
        }

        try {
            // Get all selected items from the tree view
            const selectedItems = this.treeView?.selection || [groupItem];
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
            const configManager = this.treeDataProvider.getConfigurationManager();
            for (const group of groupItems) {
                await configManager.deleteLogicalGroup(group.label);
            }

            this.treeDataProvider.refresh();

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
            const treeView = item instanceof LogicalGroupChildItem ? this.treeView : this.treeView;
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
            this.treeDataProvider.clearSearchFilter();
            if (this.treeDataProvider) {
                this.treeDataProvider.clearSearchFilter();
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
            this.treeDataProvider.clearSearchFilter();
            if (this.treeDataProvider) {
                this.treeDataProvider.clearSearchFilter();
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
                // Show file save dialog
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', fileName)),
                    saveLabel: 'Create File Here'
                });

                if (!uri) {
                    return;
                }

                targetPath = uri.fsPath;
            } else {
                // Create in workspace root
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspaceRoot) {
                    vscode.window.showErrorMessage('No workspace folder found');
                    return;
                }
                targetPath = path.join(workspaceRoot, fileName);
            }

            // Create the file if it doesn't exist
            if (fs.existsSync(targetPath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File "${path.basename(targetPath)}" already exists. Do you want to add it to the group anyway?`,
                    { modal: true },
                    'Yes'
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
            await configManager.addToLogicalGroup(
                groupItem.originalName,
                targetPath,
                path.basename(targetPath),
                'file'
            );

            this.treeDataProvider.refresh();
            NotificationManager.showInfo(`File "${path.basename(targetPath)}" created and added to group!`, { timeout: 3000 });

            // Open the file in the editor
            const fileUri = vscode.Uri.file(targetPath);
            await vscode.window.showTextDocument(fileUri);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error creating file in logical group:', err);
            vscode.window.showErrorMessage(`Failed to create file: ${err.message}`);
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
                vscode.window.showErrorMessage('Selected item is not a folder');
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
                const overwrite = await vscode.window.showWarningMessage(
                    `File "${fileName}" already exists. Do you want to open it anyway?`,
                    { modal: true },
                    'Open'
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
            await vscode.window.showTextDocument(fileUri);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error creating file in folder:', err);
            vscode.window.showErrorMessage(`Failed to create file: ${err.message}`);
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
                vscode.window.showErrorMessage('Selected item is not a folder');
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
                    vscode.window.showErrorMessage(`A file with name "${folderName}" already exists at this location`);
                    return;
                }
                const addExisting = await vscode.window.showWarningMessage(
                    `Folder "${folderName}" already exists.`,
                    { modal: true },
                    'OK'
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
            console.error('Error creating folder in folder:', err);
            vscode.window.showErrorMessage(`Failed to create folder: ${err.message}`);
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
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspaceRoot) {
                    vscode.window.showErrorMessage('No workspace folder found');
                    return;
                }
                targetPath = path.join(workspaceRoot, folderName);
            }

            // Create the folder if it doesn't exist
            if (fs.existsSync(targetPath)) {
                const stat = fs.statSync(targetPath);
                if (!stat.isDirectory()) {
                    vscode.window.showErrorMessage(`A file with name "${folderName}" already exists at this location`);
                    return;
                }
                const addExisting = await vscode.window.showWarningMessage(
                    `Folder "${folderName}" already exists. Do you want to add it to the group anyway?`,
                    { modal: true },
                    'Yes'
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
            await configManager.addToLogicalGroup(
                groupItem.originalName,
                targetPath,
                path.basename(targetPath),
                'folder'
            );

            this.treeDataProvider.refresh();
            NotificationManager.showInfo(`Folder "${path.basename(targetPath)}" created and added to group!`, { timeout: 3000 });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error creating folder in logical group:', err);
            vscode.window.showErrorMessage(`Failed to create folder: ${err.message}`);
        }
    }

}