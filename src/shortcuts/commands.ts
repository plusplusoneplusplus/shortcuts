import * as path from 'path';
import * as vscode from 'vscode';
import { InlineSearchProvider } from './inline-search-provider';
import { LogicalTreeDataProvider } from './logical-tree-data-provider';
import { NotificationManager } from './notification-manager';
import { CommandShortcutItem, FileShortcutItem, FolderShortcutItem, LogicalGroupChildItem, LogicalGroupItem, TaskShortcutItem } from './tree-items';

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

        // Show active configuration source command
        disposables.push(
            vscode.commands.registerCommand('shortcuts.showConfigSource', async () => {
                await this.showActiveConfigSource();
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
     * Open a file in the editor, respecting user preferences for markdown preview
     * @param fileUri URI of the file to open
     */
    private async openFile(fileUri: vscode.Uri): Promise<void> {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts');
        const openMarkdownInPreview = config.get<boolean>('openMarkdownInPreview', false);

        // Check if it's a markdown file
        const isMarkdown = fileUri.fsPath.toLowerCase().endsWith('.md');

        if (isMarkdown && openMarkdownInPreview) {
            // Open in preview mode
            await vscode.commands.executeCommand('markdown.showPreview', fileUri);
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
            console.error('Error resetting configuration:', err);
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
            console.error('Error opening configuration file:', err);
            NotificationManager.showError(`Failed to open configuration file: ${err.message}`);
        }
    }

    /**
     * Show information about which configuration source is currently active
     */
    private async showActiveConfigSource(): Promise<void> {
        try {
            const configManager = this.treeDataProvider.getConfigurationManager();
            const configInfo = configManager.getActiveConfigSource();

            let message: string;
            let detailMessage: string;

            switch (configInfo.source) {
                case 'workspace':
                    message = '📁 Using Workspace Configuration';
                    detailMessage = `Configuration is loaded from your workspace-specific file.\n\nPath: ${configInfo.path}\n\nThis configuration takes priority over any global configuration.`;
                    break;
                case 'global':
                    message = '🌐 Using Global Configuration';
                    detailMessage = `Configuration is loaded from your global shortcuts file.\n\nPath: ${configInfo.path}\n\nTo use a workspace-specific configuration, create a file at:\n${configManager.getConfigPath()}`;
                    break;
                case 'default':
                    message = '⚙️ Using Default Configuration';
                    detailMessage = `No configuration file found. Using built-in defaults.\n\nA workspace configuration will be created at:\n${configInfo.path}\n\nwhen you make changes or open the configuration file.`;
                    break;
            }

            const action = await vscode.window.showInformationMessage(
                message,
                { modal: false, detail: detailMessage },
                'Open Configuration',
                'Copy Path'
            );

            if (action === 'Open Configuration') {
                await this.openConfiguration();
            } else if (action === 'Copy Path') {
                await vscode.env.clipboard.writeText(configInfo.path);
                NotificationManager.showInfo('Configuration path copied to clipboard');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error showing active config source:', err);
            NotificationManager.showError(`Failed to get configuration source: ${err.message}`);
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
            console.error('Error creating nested logical group:', err);
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
                defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
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
                NotificationManager.showWarning(`${addedCount} items added successfully, ${skippedCount} items skipped (may already exist in group).`);
            } else {
                NotificationManager.showWarning('No items were added. They may already exist in the group.');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error adding to logical group:', err);
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
                defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
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
            console.error('Error adding files to logical group:', err);
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
                defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
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
            console.error('Error adding folders to logical group:', err);
            NotificationManager.showError(`Failed to add folders: ${err.message}`);
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

            // Remove all selected items (no confirmation prompt)
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
            console.error('Error renaming logical group:', err);
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
            console.error('Error deleting logical group:', err);
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
            console.error('Error copying path:', err);
            NotificationManager.showError(`Failed to copy path: ${err.message}`);
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
            NotificationManager.showError(`Failed to clear search: ${err.message}`);
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
                NotificationManager.showInfo('Search functionality is not available');
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error focusing search input:', err);
            NotificationManager.showError(`Failed to focus search input: ${err.message}`);
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
            NotificationManager.showError(`Failed to clear search: ${err.message}`);
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
                    NotificationManager.showError('No workspace folder found');
                    return;
                }
                targetPath = path.join(workspaceRoot, fileName);
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
            console.error('Error creating file in logical group:', err);
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
            console.error('Error creating file in folder:', err);
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
            console.error('Error creating folder in folder:', err);
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
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspaceRoot) {
                    NotificationManager.showError('No workspace folder found');
                    return;
                }
                targetPath = path.join(workspaceRoot, folderName);
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
            console.error('Error creating folder in logical group:', err);
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
            console.error('Error revealing in explorer:', err);
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
            console.error('Error opening terminal:', err);
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
            console.error('Error executing command:', err);
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
            console.error('Error executing task:', err);
            NotificationManager.showError(`Failed to execute task "${item.label}": ${err.message}`);
        }
    }

    /**
     * Configure cloud sync
     */
    private async configureSyncCommand(): Promise<void> {
        try {
            const settingsConfig = vscode.workspace.getConfiguration('workspaceShortcuts.sync');

            // Show quick pick for provider selection
            const providerOptions = [
                { label: 'VSCode Settings Sync', value: 'vscode', description: 'Sync via VSCode built-in sync' },
                { label: 'Azure Blob Storage', value: 'azure', description: 'Sync to Azure Blob Storage' }
            ];

            const selected = await vscode.window.showQuickPick(providerOptions, {
                placeHolder: 'Select a cloud sync provider'
            });

            if (!selected) {
                return;
            }

            // Configure the selected provider
            if (selected.value === 'vscode') {
                const scope = await vscode.window.showQuickPick(
                    [
                        { label: 'Global', value: 'global' },
                        { label: 'Workspace', value: 'workspace' }
                    ],
                    { placeHolder: 'Select VSCode sync scope' }
                );
                if (scope) {
                    await settingsConfig.update('provider', 'vscode', vscode.ConfigurationTarget.Global);
                    await settingsConfig.update('vscode.scope', scope.value, vscode.ConfigurationTarget.Global);
                    NotificationManager.showInfo('VSCode Settings Sync configured successfully');
                }
            } else if (selected.value === 'azure') {
                const container = await vscode.window.showInputBox({
                    prompt: 'Enter Azure container name',
                    placeHolder: 'shortcuts-container',
                    validateInput: (value) => {
                        if (!value || value.trim() === '') {
                            return 'Container name cannot be empty';
                        }
                        return null;
                    }
                });
                if (!container) {
                    return;
                }

                const accountName = await vscode.window.showInputBox({
                    prompt: 'Enter Azure storage account name',
                    placeHolder: 'mystorageaccount',
                    validateInput: (value) => {
                        if (!value || value.trim() === '') {
                            return 'Account name cannot be empty';
                        }
                        return null;
                    }
                });
                if (!accountName) {
                    return;
                }

                // Prompt for SAS token or connection string (stored in secrets)
                const sasToken = await vscode.window.showInputBox({
                    prompt: 'Enter Azure SAS token or connection string (stored securely)',
                    placeHolder: 'SAS token or connection string',
                    password: true,
                    validateInput: (value) => {
                        if (!value || value.trim() === '') {
                            return 'SAS token or connection string cannot be empty';
                        }
                        return null;
                    }
                });
                if (!sasToken) {
                    return;
                }

                // Save settings
                await settingsConfig.update('provider', 'azure', vscode.ConfigurationTarget.Global);
                await settingsConfig.update('azure.container', container, vscode.ConfigurationTarget.Global);
                await settingsConfig.update('azure.accountName', accountName, vscode.ConfigurationTarget.Global);

                // Store SAS token securely
                const context = (this as any).context; // Get context if available
                if (context?.secrets) {
                    await context.secrets.store('workspaceShortcuts.azure.sasToken', sasToken);
                }

                NotificationManager.showInfo('Azure Blob Storage configured successfully');
            }

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
            console.error('Error configuring sync:', err);
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
            console.error('Error enabling sync:', err);
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
            console.error('Error disabling sync:', err);
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
            console.error('Error syncing:', err);
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
            console.error('Error getting sync status:', err);
            NotificationManager.showError(`Failed to get sync status: ${err.message}`);
        }
    }

}
