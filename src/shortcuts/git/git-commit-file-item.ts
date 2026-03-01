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

        // Description shows status and line change statistics (matching branch changes style)
        this.description = this.createDescription();

        // Tooltip with full details
        this.tooltip = this.createTooltip();

        // Set resourceUri to enable VSCode to use the file icon from the current icon theme
        // For commit files, we construct the URI from the repository root and file path
        this.resourceUri = vscode.Uri.file(path.join(file.repositoryRoot, file.path));

        // Don't set iconPath - let VSCode use the default file icon from icon theme

        // Command to open diff review (same as branch changes for preview-mode tab reuse)
        this.command = {
            command: 'gitDiffComments.openWithReview',
            title: 'Open Diff',
            arguments: [this]
        };
    }

    /**
     * Get the commit file representation for diff review editor compatibility
     */
    get commitFile() {
        return {
            path: this.file.path,
            originalPath: this.file.originalPath,
            status: this.file.status,
            commitHash: this.file.commitHash,
            parentHash: this.file.parentHash,
            repositoryRoot: this.file.repositoryRoot,
        };
    }

    /**
     * Create the description text (status + line change stats)
     * Directory path omitted to match branch changes style; full path in tooltip.
     */
    private createDescription(): string {
        const parts: string[] = [];

        // Add status indicator
        const statusShort = STATUS_SHORT[this.file.status];
        parts.push(statusShort);

        // For renames, show the original path
        if (this.file.originalPath) {
            const originalName = path.basename(this.file.originalPath);
            parts.push(`\u2190 ${originalName}`);  // left arrow
        }

        // Add line change statistics (matching GitRangeFileItem format)
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
        if (this.file.additions !== undefined && this.file.additions > 0) {
            parts.push(`+${this.file.additions}`);
        }
        if (this.file.deletions !== undefined && this.file.deletions > 0) {
            parts.push(`-${this.file.deletions}`);
        }
        return parts.join('/');
    }

    /**
     * Create detailed tooltip with markdown — full path shown first for discoverability
     */
    private createTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;

        md.appendCodeblock(this.file.path, '');

        md.appendMarkdown(`**Status:** ${this.file.status}\n\n`);

        if (this.file.originalPath) {
            md.appendMarkdown(`**Original:** \`${this.file.originalPath}\`\n\n`);
        }

        if (this.file.additions !== undefined || this.file.deletions !== undefined) {
            md.appendMarkdown(`**Changes:** +${this.file.additions ?? 0} / -${this.file.deletions ?? 0}\n\n`);
        }

        md.appendMarkdown(`**Commit:** \`${this.file.commitHash.slice(0, 7)}\`\n\n`);

        md.appendMarkdown('---\n\n');
        md.appendMarkdown('*Click to open diff view*');

        return md;
    }
}

