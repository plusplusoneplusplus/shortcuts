import * as vscode from 'vscode';
import { GitCommit } from './types';

/**
 * Tree item for a looked-up commit (appears at bottom of Git View)
 * Supports multiple looked-up commits with index-based identification
 */
export class LookedUpCommitItem extends vscode.TreeItem {
    /**
     * @param commit The git commit to display
     * @param index The index of this commit in the looked-up commits list (0 = most recent)
     */
    constructor(
        public readonly commit: GitCommit,
        public readonly index: number = 0
    ) {
        super(
            `${commit.shortHash} - ${commit.subject}`,
            vscode.TreeItemCollapsibleState.Expanded
        );

        this.iconPath = new vscode.ThemeIcon('search');
        this.description = commit.relativeDate;
        this.tooltip = this.buildTooltip();
        // Include index in contextValue for command handling
        this.contextValue = `lookedUpCommit_${index}`;
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.commit.subject}**\n\n`);
        md.appendMarkdown(`- **Hash:** \`${this.commit.hash}\`\n`);
        md.appendMarkdown(`- **Author:** ${this.commit.authorName}\n`);
        md.appendMarkdown(`- **Date:** ${this.commit.relativeDate}\n`);
        if (this.commit.refs.length > 0) {
            md.appendMarkdown(`- **Refs:** ${this.commit.refs.join(', ')}\n`);
        }
        return md;
    }
}
