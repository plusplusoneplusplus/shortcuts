import * as vscode from 'vscode';

/**
 * Represents the status of a branch relative to its tracking branch
 */
export interface BranchStatus {
    /** Current branch name */
    name: string;
    /** Whether HEAD is detached */
    isDetached: boolean;
    /** Detached HEAD commit hash (only if isDetached) */
    detachedHash?: string;
    /** Number of commits ahead of tracking branch */
    ahead: number;
    /** Number of commits behind tracking branch */
    behind: number;
    /** Remote tracking branch (e.g., 'origin/main') */
    trackingBranch?: string;
    /** Whether there are uncommitted changes */
    hasUncommittedChanges: boolean;
}

/**
 * Tree item representing the current branch at the top of the Git view
 * Provides visual feedback on branch status and a clickable UI for branch switching
 */
export class BranchItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue = 'gitBranch';

    /**
     * The branch status information
     */
    public readonly status: BranchStatus;

    /**
     * Create a new branch item
     * @param status Branch status information
     */
    constructor(status: BranchStatus) {
        const label = BranchItem.formatLabel(status);
        
        // Not collapsible - clicking should open branch picker
        super(label, vscode.TreeItemCollapsibleState.None);

        this.status = status;

        // Set description (ahead/behind counts)
        this.description = this.formatDescription();

        // Set icon based on status
        this.iconPath = this.getIcon();

        // Set tooltip with detailed information
        this.tooltip = this.createTooltip();

        // Make it clickable to switch branches
        this.command = {
            command: 'gitView.switchBranch',
            title: 'Switch Branch',
            arguments: []
        };
    }

    /**
     * Format the label for the branch item
     */
    private static formatLabel(status: BranchStatus): string {
        if (status.isDetached) {
            return `(detached) ${status.detachedHash?.substring(0, 7) || 'HEAD'}`;
        }
        return status.name;
    }

    /**
     * Format the description (ahead/behind counts)
     */
    private formatDescription(): string {
        const parts: string[] = [];

        if (this.status.ahead > 0) {
            parts.push(`↑${this.status.ahead}`);
        }
        if (this.status.behind > 0) {
            parts.push(`↓${this.status.behind}`);
        }

        return parts.length > 0 ? parts.join(' ') : '';
    }

    /**
     * Get the icon based on branch status
     */
    private getIcon(): vscode.ThemeIcon {
        // Use warning icon if there are uncommitted changes
        if (this.status.hasUncommittedChanges) {
            return new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
        }
        
        // Use different color if ahead/behind
        if (this.status.ahead > 0 || this.status.behind > 0) {
            return new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
        }

        // Normal branch icon
        return new vscode.ThemeIcon('git-branch');
    }

    /**
     * Create a detailed tooltip
     */
    private createTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;

        if (this.status.isDetached) {
            md.appendMarkdown(`**Detached HEAD** at \`${this.status.detachedHash || 'unknown'}\`\n\n`);
        } else {
            md.appendMarkdown(`**Branch:** ${this.status.name}\n\n`);
        }

        if (this.status.trackingBranch) {
            md.appendMarkdown(`**Tracking:** ${this.status.trackingBranch}\n\n`);
            
            if (this.status.ahead > 0) {
                md.appendMarkdown(`- ${this.status.ahead} commit${this.status.ahead === 1 ? '' : 's'} ahead (unpushed)\n`);
            }
            if (this.status.behind > 0) {
                md.appendMarkdown(`- ${this.status.behind} commit${this.status.behind === 1 ? '' : 's'} behind (pull needed)\n`);
            }
            if (this.status.ahead === 0 && this.status.behind === 0) {
                md.appendMarkdown(`- Up to date with remote\n`);
            }
        } else if (!this.status.isDetached) {
            md.appendMarkdown(`*No upstream branch configured*\n\n`);
        }

        if (this.status.hasUncommittedChanges) {
            md.appendMarkdown(`\n⚠️ **Uncommitted changes**\n`);
        }

        md.appendMarkdown(`\n---\n*Click to switch branches*`);

        return md;
    }
}
