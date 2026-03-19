import * as vscode from 'vscode';
import { GitCommitRange } from './types';

/**
 * Tree item representing a commit range in the Git view
 * Shows the branch name, commit count, and file statistics
 */
export class GitCommitRangeItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue = 'gitCommitRange';

    /**
     * The commit range this item represents
     */
    public readonly range: GitCommitRange;

    /**
     * Create a new commit range tree item
     * @param range The git commit range to display
     */
    constructor(range: GitCommitRange) {
        // Label format: "branch-name: X commits ahead of origin/main"
        const branchDisplay = range.branchName || 'HEAD';
        const label = `${branchDisplay}: ${range.commitCount} commit${range.commitCount === 1 ? '' : 's'} ahead of ${range.baseRef}`;
        
        super(label, vscode.TreeItemCollapsibleState.Collapsed);

        this.range = range;

        // Description shows file count and line changes
        const fileCount = range.files.length;
        const statsText = this.formatStats(range.additions, range.deletions);
        this.description = `${fileCount} file${fileCount === 1 ? '' : 's'} changed • ${statsText}`;

        // Tooltip with detailed information
        this.tooltip = this.createTooltip();

        // Icon for commit range
        this.iconPath = new vscode.ThemeIcon('package');
    }

    /**
     * Format additions/deletions as a string
     */
    private formatStats(additions: number, deletions: number): string {
        const parts: string[] = [];
        if (additions > 0) {
            parts.push(`+${additions}`);
        }
        if (deletions > 0) {
            parts.push(`-${deletions}`);
        }
        return parts.length > 0 ? parts.join('/') : '0';
    }

    /**
     * Create detailed tooltip with markdown
     */
    private createTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;

        const branchDisplay = this.range.branchName || 'HEAD';
        md.appendMarkdown(`**${branchDisplay}**\n\n`);
        md.appendMarkdown(`**Commits:** ${this.range.commitCount} ahead of \`${this.range.baseRef}\`\n\n`);
        md.appendMarkdown(`**Files Changed:** ${this.range.files.length}\n\n`);
        md.appendMarkdown(`**Changes:** +${this.range.additions} / -${this.range.deletions}\n\n`);
        md.appendMarkdown(`**Merge Base:** \`${this.range.mergeBase.slice(0, 7)}\`\n\n`);
        
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('*Click to expand and see changed files*\n\n');
        md.appendMarkdown('*Right-click for more options*');

        return md;
    }
}
