import * as vscode from 'vscode';
import { TaskFolder } from './types';

/**
 * Tree item representing a folder in the Tasks Viewer
 */
export class TaskFolderItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly folder: TaskFolder;

    constructor(folder: TaskFolder) {
        super(folder.name, vscode.TreeItemCollapsibleState.Collapsed);

        this.folder = folder;
        
        // Build contextValue to enable appropriate commands
        // Format: taskFolder[_archived][_hasRelated]
        let contextValue = 'taskFolder';
        if (folder.isArchived) {
            contextValue += '_archived';
        }
        if (folder.relatedItems && folder.relatedItems.items.length > 0) {
            contextValue += '_hasRelated';
        }
        this.contextValue = contextValue;
        
        // Set description to show relative path if not root
        if (folder.relativePath) {
            this.tooltip = folder.relativePath;
        }

        this.iconPath = new vscode.ThemeIcon('folder');
    }
}
