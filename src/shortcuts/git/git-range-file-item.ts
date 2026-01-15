import * as path from 'path';
import * as vscode from 'vscode';
import { STATUS_SHORT } from './git-constants';
import { GitCommitRange, GitCommitRangeFile } from './types';

/**
 * Tree item for displaying a file changed in a commit range
 * Shows file status, path, and line change statistics
 */
export class GitRangeFileItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     * Includes _md suffix for markdown files to enable context menu filtering
     */
    public readonly contextValue: string;

    /**
     * The file this item represents
     */
    public readonly file: GitCommitRangeFile;

    /**
     * The commit range this file belongs to
     */
    public readonly range: GitCommitRange;

    /**
     * Create a new range file tree item
     * @param file The git commit range file to display
     * @param range The parent commit range
     */
    constructor(file: GitCommitRangeFile, range: GitCommitRange) {
        // Label is the filename
        super(path.basename(file.path), vscode.TreeItemCollapsibleState.None);

        this.file = file;
        this.range = range;

        // Include file extension in contextValue for context menu filtering
        const ext = path.extname(file.path).toLowerCase();
        const isMarkdown = ext === '.md';
        this.contextValue = `gitRangeFile${isMarkdown ? '_md' : ''}`;

        // Description shows status, directory path, and line changes
        this.description = this.createDescription();

        // Tooltip with full details
        this.tooltip = this.createTooltip();

        // Set resourceUri to enable VSCode to use the file icon from the current icon theme
        this.resourceUri = vscode.Uri.file(path.join(file.repositoryRoot, file.path));

        // Command to open diff view
        this.command = {
            command: 'gitDiffComments.openWithReview',
            title: 'Open Range Diff',
            arguments: [this]
        };
    }

    /**
     * Create the description text (status + directory path + line changes)
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
        if (this.file.oldPath) {
            const originalName = path.basename(this.file.oldPath);
            parts.push(`\u2190 ${originalName}`);  // left arrow
        }

        // Add line change statistics
        const statsText = this.formatStats();
        if (statsText) {
            parts.push(`(${statsText})`);
        }

        return parts.join(' ');
    }

    /**
     * Format additions/deletions as a string
     */
    private formatStats(): string {
        const parts: string[] = [];
        if (this.file.additions > 0) {
            parts.push(`+${this.file.additions}`);
        }
        if (this.file.deletions > 0) {
            parts.push(`-${this.file.deletions}`);
        }
        return parts.join('/');
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

        if (this.file.oldPath) {
            md.appendMarkdown(`**Original:** \`${this.file.oldPath}\`\n\n`);
        }

        md.appendMarkdown(`**Changes:** +${this.file.additions} / -${this.file.deletions}\n\n`);
        md.appendMarkdown(`**Range:** \`${this.range.baseRef}...${this.range.headRef}\`\n\n`);

        md.appendMarkdown('---\n\n');
        md.appendMarkdown('*Click to open combined diff view*');

        return md;
    }

    /**
     * Get the commit file representation for compatibility with existing diff review
     * This allows the diff review editor to handle range files
     */
    get commitFile() {
        return {
            path: this.file.path,
            originalPath: this.file.oldPath,
            status: this.file.status,
            // Use merge base as parent for diff comparison
            commitHash: this.range.headRef,
            parentHash: this.range.baseRef,
            repositoryRoot: this.file.repositoryRoot,
            // Mark this as a range file for special handling
            isRangeFile: true,
            range: this.range
        };
    }
}
