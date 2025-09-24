import * as vscode from 'vscode';
import { ShortcutsTreeDataProvider } from './tree-data-provider';
import { FolderShortcutItem } from './tree-items';

/**
 * Command handlers for the shortcuts panel
 */
export class ShortcutsCommands {
    constructor(private treeDataProvider: ShortcutsTreeDataProvider) { }

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
            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.addShortcut(
                selectedFolder.fsPath,
                displayName || undefined
            );

            // Refresh the tree view
            this.treeDataProvider.refresh();

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
            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.removeShortcut(item.fsPath);

            // Refresh the tree view
            this.treeDataProvider.refresh();

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
            const configManager = this.treeDataProvider.getConfigurationManager();
            await configManager.renameShortcut(item.fsPath, newName.trim());

            // Refresh the tree view
            this.treeDataProvider.refresh();

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
        this.treeDataProvider.refresh();
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
            const configManager = this.treeDataProvider.getConfigurationManager();
            const { DEFAULT_SHORTCUTS_CONFIG } = await import('./types');
            await configManager.saveConfiguration(DEFAULT_SHORTCUTS_CONFIG);

            // Refresh the tree view
            this.treeDataProvider.refresh();

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
            const configManager = this.treeDataProvider.getConfigurationManager();
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
}