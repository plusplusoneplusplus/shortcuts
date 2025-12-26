import * as path from 'path';
import * as vscode from 'vscode';
import { STATUS_SHORT } from './git-constants';
import { GitChange } from './types';

/**
 * Tree item for displaying a git change in the tree view
 * Uses VSCode's default file icons from the current icon theme.
 * Colors are applied via git decorations based on the resourceUri.
 */
export class GitChangeItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly change: GitChange;
    public readonly isLoading: boolean;

    constructor(change: GitChange, isLoading: boolean = false) {
        // Label is the filename
        super(path.basename(change.path), vscode.TreeItemCollapsibleState.None);

        this.change = change;
        this.isLoading = isLoading;
        
        // Include file extension in contextValue for context menu filtering
        // Add _loading suffix when the file is being staged/unstaged
        const ext = path.extname(change.path).toLowerCase();
        const isMarkdown = ext === '.md';
        const loadingSuffix = isLoading ? '_loading' : '';
        this.contextValue = `gitChange_${change.stage}${isMarkdown ? '_md' : ''}${loadingSuffix}`;

        // Description shows status indicator and relative path
        // Add loading indicator if applicable
        this.description = this.getDescription();

        // Tooltip with full details
        this.tooltip = this.createTooltip();

        // Resource URI - this enables VSCode to use the file icon from the current icon theme
        // and apply git decorations (colors) based on the file status
        this.resourceUri = change.uri;

        // When loading, show a spinner icon and gray out the item
        if (isLoading) {
            this.iconPath = new vscode.ThemeIcon('loading~spin');
            // Disable the command while loading
            this.command = undefined;
        } else {
            // Don't set iconPath - let VSCode use the default file icon from icon theme
            // The color will be applied via git decorations on resourceUri
            
            // Command to open diff review view with inline commenting
            this.command = {
                command: 'gitDiffComments.openWithReview',
                title: 'Open Diff Review',
                arguments: [this]
            };
        }
    }

    /**
     * Get the description text (status indicator + relative path)
     * Format: "M • src/folder" or "A • src/folder"
     * When loading: "⏳ M • src/folder"
     */
    private getDescription(): string {
        const relativePath = path.relative(
            this.change.repositoryRoot,
            path.dirname(this.change.path)
        );

        const parts: string[] = [];

        // Add loading indicator if applicable
        if (this.isLoading) {
            parts.push('⏳');
        }

        // Add status short code (M, A, D, R, etc.)
        const statusShort = STATUS_SHORT[this.change.status];
        parts.push(statusShort);

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

