import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ShortcutsCommands } from './shortcuts/commands';
import { ConfigurationManager } from './shortcuts/configuration-manager';
import { ShortcutsDragDropController } from './shortcuts/drag-drop-controller';
import { FileSystemWatcherManager } from './shortcuts/file-system-watcher-manager';
import { InlineSearchProvider } from './shortcuts/inline-search-provider';
import { KeyboardNavigationHandler } from './shortcuts/keyboard-navigation';
import { LogicalTreeDataProvider } from './shortcuts/logical-tree-data-provider';
import { NotificationManager } from './shortcuts/notification-manager';
import { ThemeManager } from './shortcuts/theme-manager';

/**
 * Get a stable global configuration path when no workspace is open
 */
function getGlobalConfigPath(): string {
    // Use VS Code's global storage path or fallback to home directory
    return path.join(os.homedir(), '.vscode-shortcuts');
}

/**
 * This method is called when your extension is activated
 * Your extension is activated the very first time the command is executed
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Shortcuts extension is now active!');

    // Check if we have a workspace folder, use stable directory if none
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceRoot = workspaceFolder?.uri.fsPath || getGlobalConfigPath();
    console.log(`Initializing shortcuts panel for workspace: ${workspaceRoot}`);

    try {
        // Initialize configuration and theme managers
        const configurationManager = new ConfigurationManager(workspaceRoot);
        const themeManager = new ThemeManager();

        // Set up file watcher for configuration changes
        const treeDataProvider = new LogicalTreeDataProvider(
            workspaceRoot,
            configurationManager,
            themeManager
        );

        // Set up file system watchers for referenced folders
        const fileSystemWatcherManager = new FileSystemWatcherManager(
            workspaceRoot,
            configurationManager,
            () => {
                treeDataProvider.refresh();
            }
        );

        // Initialize file system watchers
        fileSystemWatcherManager.initialize();

        // Initialize theme management with refresh callback
        themeManager.initialize(() => {
            treeDataProvider.refresh();
        });

        // Initialize drag and drop controller
        const dragDropController = new ShortcutsDragDropController();

        // Register tree view with drag and drop support
        const treeView = vscode.window.createTreeView('shortcutsView', {
            treeDataProvider: treeDataProvider,
            showCollapseAll: true,
            canSelectMany: true,
            dragAndDropController: dragDropController
        });

        // Connect refresh callback to drag-drop controller
        dragDropController.setRefreshCallback(() => {
            treeDataProvider.refresh();
        });

        // Create unified search provider
        const unifiedSearchProvider = new InlineSearchProvider(
            context.extensionUri,
            'shortcutsSearch',
            'Search groups...'
        );

        // Register webview provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('shortcutsSearch', unifiedSearchProvider)
        );

        // Connect search provider to tree data provider
        unifiedSearchProvider.onSearchChanged((searchTerm) => {
            treeDataProvider.setSearchFilter(searchTerm);
        });

        // Function to update view descriptions - show config source
        const updateSearchDescriptions = () => {
            // Show which config source is active
            const configInfo = configurationManager.getActiveConfigSource();
            let sourceLabel: string;

            switch (configInfo.source) {
                case 'workspace':
                    sourceLabel = '📁 Workspace';
                    break;
                case 'global':
                    sourceLabel = '🌐 Global';
                    break;
                case 'default':
                    sourceLabel = '⚙️ Default';
                    break;
            }

            treeView.description = sourceLabel;
        };

        // Initial description setup
        updateSearchDescriptions();

        // Watch configuration file for changes
        configurationManager.watchConfigFile(() => {
            treeDataProvider.refresh();
            fileSystemWatcherManager.updateWatchers();
            updateSearchDescriptions();
        });

        // Initialize keyboard navigation handler
        const keyboardNavigationHandler = new KeyboardNavigationHandler(treeView, treeDataProvider, 'logical');

        // Initialize command handlers
        const commandsHandler = new ShortcutsCommands(
            treeDataProvider,
            updateSearchDescriptions,
            unifiedSearchProvider,
            treeView
        );
        const commandDisposables = commandsHandler.registerCommands(context);

        // Register keyboard help command
        const keyboardHelpCommand = vscode.commands.registerCommand('shortcuts.showKeyboardHelp', () => {
            const helpText = KeyboardNavigationHandler.getKeyboardShortcutsHelp();
            vscode.window.showInformationMessage(
                'Keyboard shortcuts for Shortcuts panel:',
                { modal: true, detail: helpText }
            );
        });

        // Register undo command for drag and drop operations
        const undoMoveCommand = vscode.commands.registerCommand('shortcuts.undoMove', async () => {
            if (dragDropController.canUndo()) {
                await dragDropController.undoLastMove();
            } else {
                vscode.window.showInformationMessage('No move operation to undo.');
            }
        });

        // Collect all disposables for proper cleanup
        const disposables: vscode.Disposable[] = [
            treeView,
            treeDataProvider,
            configurationManager,
            themeManager,
            fileSystemWatcherManager,
            keyboardNavigationHandler,
            keyboardHelpCommand,
            undoMoveCommand,
            ...commandDisposables
        ];

        // Add all disposables to context subscriptions
        context.subscriptions.push(...disposables);

        console.log('Shortcuts extension activated successfully');

        // Show welcome message on first activation
        const hasShownWelcome = context.globalState.get('shortcuts.hasShownWelcome', false);
        if (!hasShownWelcome) {
            NotificationManager.showInfo(
                'Shortcuts panel is now available! Right-click in the panel to add groups.',
                { timeout: 8000, actions: ['Got it!'] }
            ).then(() => {
                context.globalState.update('shortcuts.hasShownWelcome', true);
            });
        }

    } catch (error) {
        console.error('Error activating shortcuts extension:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to activate shortcuts extension: ${message}`);
    }
}

/**
 * This method is called when your extension is deactivated
 */
export function deactivate() {
    console.log('Shortcuts extension is being deactivated');
    // Cleanup is handled automatically by VSCode through context.subscriptions
    // All registered disposables will be disposed automatically
}