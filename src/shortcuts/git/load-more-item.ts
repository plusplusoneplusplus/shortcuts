import * as vscode from 'vscode';

/**
 * Tree item for the "Load More Commits" button
 * Appears at the end of the commits list when more commits are available
 */
export class LoadMoreItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue = 'gitLoadMore';

    /**
     * Number of commits to load when clicked
     */
    public readonly loadCount: number;

    /**
     * Create a new load more item
     * @param loadCount Number of commits to load when clicked (default: 20)
     */
    constructor(loadCount: number = 20) {
        super('Load More Commits...', vscode.TreeItemCollapsibleState.None);

        this.loadCount = loadCount;

        // Description shows how many will be loaded
        this.description = `(${loadCount} more)`;

        // Tooltip
        this.tooltip = `Click to load ${loadCount} more commits`;

        // Icon
        this.iconPath = new vscode.ThemeIcon('ellipsis');

        // Command to load more commits
        this.command = {
            command: 'gitView.loadMoreCommits',
            title: 'Load More Commits',
            arguments: [loadCount]
        };
    }
}

