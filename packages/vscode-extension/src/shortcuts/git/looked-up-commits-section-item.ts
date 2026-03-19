import * as vscode from 'vscode';

/**
 * Tree item representing the "Looked Up Commits" section in the Git view.
 * This is a collapsible container that groups all looked-up commits together.
 * It is collapsed by default to enable lazy loading of children.
 */
export class LookedUpCommitsSectionItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue = 'lookedUpCommitsSection';

    /**
     * Create a new looked-up commits section header
     * @param count Number of looked-up commits in this section
     */
    constructor(count: number) {
        super('Looked Up Commits', vscode.TreeItemCollapsibleState.Collapsed);

        // Show count in description (handle negative counts gracefully)
        this.description = count > 0 ? `${count}` : '0';
        const displayCount = count > 0 ? count : 0;

        // Use search icon to indicate this is for looked-up/searched commits
        this.iconPath = new vscode.ThemeIcon('search');

        // Set tooltip
        this.tooltip = this.createTooltip(displayCount);
    }

    /**
     * Create tooltip for this section
     */
    private createTooltip(count: number): string {
        if (count === 0) {
            return 'No looked-up commits';
        }
        return `${count} looked-up commit${count === 1 ? '' : 's'}`;
    }
}
