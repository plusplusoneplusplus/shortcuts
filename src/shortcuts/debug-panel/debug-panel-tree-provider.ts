import * as vscode from 'vscode';
import { DebugCommand, getDefaultDebugCommands } from './debug-commands';
import { DebugCommandItem } from './debug-command-item';

/**
 * Tree data provider for the Debug Panel view
 * Displays a flat list of debug commands that can be triggered
 */
export class DebugPanelTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private commands: DebugCommand[];

    constructor() {
        this.commands = getDefaultDebugCommands();
    }

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children of an element or root elements if no element is provided
     */
    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (!element) {
            // Return root level debug commands
            return this.commands.map(cmd => new DebugCommandItem(cmd));
        }
        // Debug commands have no children
        return [];
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

