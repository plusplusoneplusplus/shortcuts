import * as vscode from 'vscode';
import { DebugCommand } from './debug-commands';

/**
 * Tree item representing a debug command in the Debug Panel
 */
export class DebugCommandItem extends vscode.TreeItem {
    constructor(command: DebugCommand) {
        super(command.label, vscode.TreeItemCollapsibleState.None);
        
        this.description = command.description;
        this.tooltip = command.tooltip || command.description;
        this.iconPath = new vscode.ThemeIcon(command.icon);
        
        // When clicked, execute the debug command
        this.command = {
            command: 'debugPanel.executeCommand',
            title: 'Execute',
            arguments: [command.commandId, command.args]
        };
        
        this.contextValue = 'debugCommand';
    }
}

