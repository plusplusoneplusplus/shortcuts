import * as vscode from 'vscode';
import { GitCommit } from './types';

/**
 * Tree item for the looked-up commit (appears at bottom of Git View)
 */
export class LookedUpCommitItem extends vscode.TreeItem {
    constructor(public readonly commit: GitCommit) {
        super(
            `${commit.shortHash} - ${commit.subject}`,
            vscode.TreeItemCollapsibleState.Expanded
        );

        this.iconPath = new vscode.ThemeIcon('search');
        this.description = commit.relativeDate;
        this.tooltip = this.buildTooltip();
        this.contextValue = 'lookedUpCommit';
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
