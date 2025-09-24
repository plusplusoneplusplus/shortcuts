import * as vscode from 'vscode';

/**
 * This method is called when your extension is activated
 * Your extension is activated the very first time the command is executed
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('VSCode extension is now active!');

    // Register commands and add them to the context subscriptions for proper disposal
    const disposables: vscode.Disposable[] = [];

    // Register the hello world command
    const helloWorldCommand = vscode.commands.registerCommand('shortcuts.helloWorld', () => {
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World from Shortcuts Extension!');
    });

    // Add command to disposables for proper cleanup
    disposables.push(helloWorldCommand);

    // Add all disposables to context subscriptions
    context.subscriptions.push(...disposables);

    console.log('Extension commands registered successfully');
}

/**
 * This method is called when your extension is deactivated
 */
export function deactivate() {
    console.log('VSCode extension is being deactivated');
    // Cleanup is handled automatically by VSCode through context.subscriptions
}