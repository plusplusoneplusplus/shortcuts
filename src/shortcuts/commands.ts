import * as vscode from 'vscode';
import { ShortcutsTreeDataProvider } from './tree-data-provider';
import { LogicalTreeDataProvider } from './logical-tree-data-provider';
import { FolderShortcutItem, LogicalGroupItem, LogicalGroupChildItem } from './tree-items';
import { LogicalGroup } from './types';

/**
 * Command handlers for the shortcuts panel
 */
export class ShortcutsCommands {
    constructor(
        private physicalTreeDataProvider: ShortcutsTreeDataProvider,
        private logicalTreeDataProvider?: LogicalTreeDataProvider
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

            vscode.window.showInformationMessage('Folder shortcut added successfully!');

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

            vscode.window.showInformationMessage('Shortcut removed successfully!');

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

            vscode.window.showInformationMessage('Shortcut renamed successfully!');

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
        vscode.window.showInformationMessage('Shortcuts refreshed!');
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

            vscode.window.showInformationMessage('Configuration reset to default successfully!');

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

            // Create the file if it doesn't exist
            const { DEFAULT_SHORTCUTS_CONFIG } = await import('./types');
            await configManager.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);

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
            vscode.window.showInformationMessage('Logical group created successfully!');

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error creating logical group:', err);
            vscode.window.showErrorMessage(`Failed to create logical group: ${err.message}`);
        }
    }

    /**
     * Add a folder or file to a logical group
     */
    private async addToLogicalGroup(groupItem: LogicalGroupItem): Promise<void> {
        if (!this.logicalTreeDataProvider) {
            return;
        }

        try {
            const itemType = await vscode.window.showQuickPick(['Folder', 'File'], {
                placeHolder: 'Select item type to add'
            });

            if (!itemType) {
                return;
            }

            const uri = await vscode.window.showOpenDialog({
                canSelectFiles: itemType === 'File',
                canSelectFolders: itemType === 'Folder',
                canSelectMany: false,
                openLabel: `Add ${itemType}`
            });

            if (!uri || uri.length === 0) {
                return;
            }

            const displayName = await vscode.window.showInputBox({
                prompt: 'Enter a display name for this item',
                placeHolder: 'Item display name',
                value: uri[0].path.split('/').pop() || ''
            });

            if (!displayName) {
                return;
            }

            const configManager = this.logicalTreeDataProvider.getConfigurationManager();
            await configManager.addToLogicalGroup(
                groupItem.label,
                uri[0].fsPath,
                displayName.trim(),
                itemType.toLowerCase() as 'folder' | 'file'
            );

            this.logicalTreeDataProvider.refresh();
            vscode.window.showInformationMessage('Item added to logical group successfully!');

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
            vscode.window.showInformationMessage('Item removed from logical group successfully!');

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
            vscode.window.showInformationMessage('Logical group renamed successfully!');

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
            vscode.window.showInformationMessage('Logical group deleted successfully!');

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error deleting logical group:', err);
            vscode.window.showErrorMessage(`Failed to delete logical group: ${err.message}`);
        }
    }
}