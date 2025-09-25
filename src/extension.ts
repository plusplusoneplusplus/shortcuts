import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ShortcutsCommands } from './shortcuts/commands';
import { ShortcutsTreeDataProvider } from './shortcuts/tree-data-provider';
import { KeyboardNavigationHandler } from './shortcuts/keyboard-navigation';

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
        // Initialize tree data provider
        const treeDataProvider = new ShortcutsTreeDataProvider(workspaceRoot);

        // Register tree view with VS Code with theming support
        const treeView = vscode.window.createTreeView('shortcutsPanel', {
            treeDataProvider: treeDataProvider,
            showCollapseAll: true,
            canSelectMany: false,
            dragAndDropController: undefined // Disable drag and drop for now
        });

        // Initialize keyboard navigation handler
        const keyboardNavigationHandler = new KeyboardNavigationHandler(treeView, treeDataProvider);

        // Initialize command handlers
        const commandsHandler = new ShortcutsCommands(treeDataProvider);
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
            treeView,
            treeDataProvider,
            keyboardNavigationHandler,
            keyboardHelpCommand,
            ...commandDisposables
        ];

        // Add all disposables to context subscriptions
        context.subscriptions.push(...disposables);

        console.log('Shortcuts extension activated successfully');

        // Show welcome message on first activation
        const hasShownWelcome = context.globalState.get('shortcuts.hasShownWelcome', false);
        if (!hasShownWelcome) {
            vscode.window.showInformationMessage(
                'Shortcuts panel is now available! Right-click in the panel to add folder shortcuts.',
                'Got it!'
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