import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ShortcutsCommands } from './shortcuts/commands';
import { ShortcutsTreeDataProvider } from './shortcuts/tree-data-provider';
import { LogicalTreeDataProvider } from './shortcuts/logical-tree-data-provider';
import { KeyboardNavigationHandler } from './shortcuts/keyboard-navigation';
import { NotificationManager } from './shortcuts/notification-manager';
import { InlineSearchProvider } from './shortcuts/inline-search-provider';

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
        // Initialize physical tree data provider
        const physicalTreeDataProvider = new ShortcutsTreeDataProvider(workspaceRoot);

        // Initialize logical tree data provider
        const logicalTreeDataProvider = new LogicalTreeDataProvider(
            workspaceRoot,
            physicalTreeDataProvider.getConfigurationManager(),
            physicalTreeDataProvider.getThemeManager()
        );

        // Register physical tree view
        const physicalTreeView = vscode.window.createTreeView('shortcutsPhysical', {
            treeDataProvider: physicalTreeDataProvider,
            showCollapseAll: true,
            canSelectMany: false,
            dragAndDropController: undefined
        });

        // Register logical tree view
        const logicalTreeView = vscode.window.createTreeView('shortcutsLogical', {
            treeDataProvider: logicalTreeDataProvider,
            showCollapseAll: true,
            canSelectMany: false,
            dragAndDropController: undefined
        });

        // Create unified search provider
        const unifiedSearchProvider = new InlineSearchProvider(
            context.extensionUri,
            'shortcutsSearch',
            'Search folders and groups...'
        );

        // Register webview provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('shortcutsSearch', unifiedSearchProvider)
        );

        // Connect search provider to both tree data providers
        unifiedSearchProvider.onSearchChanged((searchTerm) => {
            physicalTreeDataProvider.setSearchFilter(searchTerm);
            logicalTreeDataProvider.setSearchFilter(searchTerm);
        });

        // Function to update view descriptions - simplified since we have inline search
        const updateSearchDescriptions = () => {
            // Clear descriptions since search is now inline
            physicalTreeView.description = undefined;
            logicalTreeView.description = undefined;
        };

        // Initial description setup
        updateSearchDescriptions();

        // Initialize keyboard navigation handlers for both views
        const physicalKeyboardNavigationHandler = new KeyboardNavigationHandler(physicalTreeView, physicalTreeDataProvider, 'physical');
        const logicalKeyboardNavigationHandler = new KeyboardNavigationHandler(logicalTreeView, logicalTreeDataProvider, 'logical');

        // Initialize command handlers
        const commandsHandler = new ShortcutsCommands(physicalTreeDataProvider, logicalTreeDataProvider, updateSearchDescriptions, unifiedSearchProvider);
        const commandDisposables = commandsHandler.registerCommands(context);

        // Register keyboard help command
        const keyboardHelpCommand = vscode.commands.registerCommand('shortcuts.showKeyboardHelp', () => {
            const helpText = KeyboardNavigationHandler.getKeyboardShortcutsHelp();
            vscode.window.showInformationMessage(
                'Keyboard shortcuts for Shortcuts panel:',
                { modal: true, detail: helpText }
            );
        });

        // Collect all disposables for proper cleanup
        const disposables: vscode.Disposable[] = [
            physicalTreeView,
            logicalTreeView,
            physicalTreeDataProvider,
            logicalTreeDataProvider,
            physicalKeyboardNavigationHandler,
            logicalKeyboardNavigationHandler,
            keyboardHelpCommand,
            ...commandDisposables
        ];

        // Add all disposables to context subscriptions
        context.subscriptions.push(...disposables);

        console.log('Shortcuts extension activated successfully');

        // Show welcome message on first activation
        const hasShownWelcome = context.globalState.get('shortcuts.hasShownWelcome', false);
        if (!hasShownWelcome) {
            NotificationManager.showInfo(
                'Shortcuts panel is now available! Right-click in the panel to add folder shortcuts.',
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