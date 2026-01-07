import * as path from 'path';
import * as vscode from 'vscode';
import { STATUS_SHORT } from './git-constants';
import { GitCommitFile } from './types';

/**
 * Tree item for displaying a file changed in a commit
 */
export class GitCommitFileItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     * Includes _md suffix for markdown files to enable context menu filtering
     */
    public readonly contextValue: string;

    /**
     * The commit file this item represents
     */
    public readonly file: GitCommitFile;

    /**
     * Create a new commit file tree item
     * @param file The git commit file to display
     */
    constructor(file: GitCommitFile) {
        // Label is the filename
        super(path.basename(file.path), vscode.TreeItemCollapsibleState.None);

        this.file = file;

        // Include file extension in contextValue for context menu filtering
        const ext = path.extname(file.path).toLowerCase();
        const isMarkdown = ext === '.md';
        this.contextValue = `gitCommitFile${isMarkdown ? '_md' : ''}`;

        // Description shows relative directory path and status
        this.description = this.createDescription();

        // Tooltip with full details
        this.tooltip = this.createTooltip();

        // Set resourceUri to enable VSCode to use the file icon from the current icon theme
        // For commit files, we construct the URI from the repository root and file path
        this.resourceUri = vscode.Uri.file(path.join(file.repositoryRoot, file.path));

        // Don't set iconPath - let VSCode use the default file icon from icon theme

        // Command to open diff view
        this.command = {
            command: 'gitView.openCommitFileDiff',
            title: 'Open Diff',
            arguments: [file]
        };
    }

    /**
     * Create the description text (relative directory path + status)
     */
    private createDescription(): string {
        const parts: string[] = [];

        // Add status indicator
        const statusShort = STATUS_SHORT[this.file.status];
        parts.push(statusShort);

        // Add relative directory path if not in repo root
        const dirPath = path.dirname(this.file.path);
        if (dirPath && dirPath !== '.') {
            parts.push(`\u2022 ${dirPath}`);  // bullet point separator
        }

        // For renames, show the original path
        if (this.file.originalPath) {
            const originalName = path.basename(this.file.originalPath);
            parts.push(`\u2190 ${originalName}`);  // left arrow
        }

        return parts.join(' ');
    }

    /**
     * Create detailed tooltip with markdown
     */
    private createTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;

        md.appendMarkdown(`**${path.basename(this.file.path)}**\n\n`);
        md.appendMarkdown(`**Status:** ${this.file.status}\n\n`);
        md.appendMarkdown(`**Path:** \`${this.file.path}\`\n\n`);

        if (this.file.originalPath) {
            md.appendMarkdown(`**Original:** \`${this.file.originalPath}\`\n\n`);
        }

        md.appendMarkdown(`**Commit:** \`${this.file.commitHash.slice(0, 7)}\`\n\n`);

        md.appendMarkdown('---\n\n');
        md.appendMarkdown('*Click to open diff view*');

        return md;
    }
}

