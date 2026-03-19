import * as vscode from 'vscode';

/**
 * Tree item representing the "Branch Changes" section header in the Git view
 * This section shows commit ranges (files changed across multiple commits)
 */
export class BranchChangesSectionItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue = 'gitSection_branchChanges';

    /**
     * Create a new branch changes section header
     * @param rangeCount Number of commit ranges in this section (usually 1)
     */
    constructor(rangeCount: number = 1) {
        super('Branch Changes', vscode.TreeItemCollapsibleState.Expanded);

        // Show count in description
        if (rangeCount > 0) {
            this.description = `${rangeCount}`;
        }

        // Set icon
        this.iconPath = new vscode.ThemeIcon('git-branch');

        // Set tooltip
        this.tooltip = rangeCount === 1
            ? 'Changes on current branch compared to remote default branch'
            : `${rangeCount} commit ranges`;
    }
}
