import * as vscode from 'vscode';

/**
 * URI scheme used for task tree items that should appear dimmed (grayed out).
 * Items with future status or archived status use this scheme so the
 * FileDecorationProvider can apply disabledForeground color to their labels.
 */
export const DIMMED_TASK_SCHEME = 'shortcuts-task-dimmed';

/**
 * Create a dimmed URI for a task item.
 * Converts a file path to a URI with the dimmed scheme so that
 * TaskDecorationProvider applies disabledForeground color.
 */
export function createDimmedTaskUri(filePath: string): vscode.Uri {
    return vscode.Uri.file(filePath).with({ scheme: DIMMED_TASK_SCHEME });
}

/**
 * FileDecorationProvider that grays out task tree items with future or archived status.
 * Works by matching the custom URI scheme set on dimmed tree items' resourceUri.
 */
export class TaskDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        if (uri.scheme === DIMMED_TASK_SCHEME) {
            return {
                color: new vscode.ThemeColor('disabledForeground')
            };
        }
        return undefined;
    }
}
