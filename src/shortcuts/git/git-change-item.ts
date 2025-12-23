import * as path from 'path';
import * as vscode from 'vscode';
import { STAGE_PREFIX } from './git-constants';
import { GitChange } from './types';

/**
 * Tree item for displaying a git change in the tree view
 * Uses VSCode's default file icons from the current icon theme.
 * Colors are applied via git decorations based on the resourceUri.
 */
export class GitChangeItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly change: GitChange;

    constructor(change: GitChange) {
        // Label is the filename
        super(path.basename(change.path), vscode.TreeItemCollapsibleState.None);

        this.change = change;
        this.contextValue = `gitChange_${change.stage}`;

        // Description shows relative path and stage indicator
        this.description = this.getDescription();

        // Tooltip with full details
        this.tooltip = this.createTooltip();

        // Resource URI - this enables VSCode to use the file icon from the current icon theme
        // and apply git decorations (colors) based on the file status
        this.resourceUri = change.uri;

        // Don't set iconPath - let VSCode use the default file icon from icon theme
        // The color will be applied via git decorations on resourceUri

        // Command to open diff review view with inline commenting
        this.command = {
            command: 'gitDiffComments.openWithReview',
            title: 'Open Diff Review',
            arguments: [this]
        };
    }

    /**
     * Get the description text (relative path + stage indicator)
     * Format: "✓ staged" or "○ modified" or "? untracked" + path
     */
    private getDescription(): string {
        const relativePath = path.relative(
            this.change.repositoryRoot,
            path.dirname(this.change.path)
        );

        const parts: string[] = [];

        // Add stage prefix symbol and label for clarity
        const stagePrefix = STAGE_PREFIX[this.change.stage];
        if (this.change.stage === 'staged') {
            parts.push(`${stagePrefix} staged`);
        } else if (this.change.stage === 'untracked') {
            parts.push(`${stagePrefix} untracked`);
        } else {
            parts.push(`${stagePrefix} modified`);
        }

        // Add relative path if not in repo root
        if (relativePath && relativePath !== '.') {
            parts.push(`\u2022 ${relativePath}`);  // bullet point separator
        }

        return parts.join(' ');
    }

    /**
     * Create detailed tooltip with markdown
     */
    private createTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;

        md.appendMarkdown(`**${path.basename(this.change.path)}**\n\n`);
        md.appendMarkdown(`**Status:** ${this.change.status}\n\n`);
        md.appendMarkdown(`**Stage:** ${this.change.stage}\n\n`);
        md.appendMarkdown(`**Repository:** ${this.change.repositoryName}\n\n`);
        md.appendMarkdown(`**Path:** \`${this.change.path}\`\n\n`);

        if (this.change.originalPath) {
            md.appendMarkdown(`**Original:** \`${this.change.originalPath}\`\n\n`);
        }

        md.appendMarkdown('---\n\n');
        md.appendMarkdown('*Click to open diff review*');

        return md;
    }
}

