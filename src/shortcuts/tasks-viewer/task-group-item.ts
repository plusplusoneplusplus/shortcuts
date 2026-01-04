import * as vscode from 'vscode';

/**
 * Tree item representing a group header in the Tasks Viewer
 * Used to group active and archived tasks when Show Archived is enabled
 */
export class TaskGroupItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly groupType: 'active' | 'archived';
    public readonly taskCount: number;

    constructor(groupType: 'active' | 'archived', taskCount: number) {
        const label = groupType === 'active' ? 'Active Tasks' : 'Archived Tasks';
        super(label, vscode.TreeItemCollapsibleState.Expanded);

        this.groupType = groupType;
        this.taskCount = taskCount;
        this.contextValue = `taskGroup_${groupType}`;
        this.description = `${taskCount}`;
        this.iconPath = this.getIconPath(groupType);
    }

    /**
     * Get the icon for the group header
     */
    private getIconPath(groupType: 'active' | 'archived'): vscode.ThemeIcon {
        if (groupType === 'archived') {
            return new vscode.ThemeIcon('archive', new vscode.ThemeColor('disabledForeground'));
        }
        return new vscode.ThemeIcon('tasklist');
    }
}

