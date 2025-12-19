import * as path from 'path';
import * as vscode from 'vscode';
import { GitCommitFile, GitChangeStatus } from './types';

/**
 * Icon configuration for each git change status
 */
interface StatusIconConfig {
    icon: string;
    color: string;
}

/**
 * Icons for commit file changes
 */
const STATUS_ICON_MAP: Record<GitChangeStatus, StatusIconConfig> = {
    'modified': { icon: 'diff-modified', color: 'terminal.ansiYellow' },
    'added': { icon: 'diff-added', color: 'terminal.ansiGreen' },
    'deleted': { icon: 'diff-removed', color: 'terminal.ansiRed' },
    'renamed': { icon: 'diff-renamed', color: 'terminal.ansiBlue' },
    'copied': { icon: 'diff-added', color: 'terminal.ansiBlue' },
    'untracked': { icon: 'question', color: 'terminal.ansiMagenta' },
    'ignored': { icon: 'circle-slash', color: 'disabledForeground' },
    'conflict': { icon: 'warning', color: 'terminal.ansiRed' }
};

/**
 * Short status indicator for display
 */
const STATUS_SHORT: Record<GitChangeStatus, string> = {
    'modified': 'M',
    'added': 'A',
    'deleted': 'D',
    'renamed': 'R',
    'copied': 'C',
    'untracked': 'U',
    'ignored': 'I',
    'conflict': '!'
};

/**
 * Tree item for displaying a file changed in a commit
 */
export class GitCommitFileItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue = 'gitCommitFile';

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

        // Description shows relative directory path and status
        this.description = this.createDescription();

        // Tooltip with full details
        this.tooltip = this.createTooltip();

        // Status-specific icon with color
        this.iconPath = this.getStatusIcon();

        // Command to open diff view
        this.command = {
            command: 'gitView.openCommitFileDiff',
            title: 'Open Diff',
            arguments: [file]
        };
    }

    /**
     * Get the status icon with appropriate color
     */
    private getStatusIcon(): vscode.ThemeIcon {
        const config = STATUS_ICON_MAP[this.file.status];
        return new vscode.ThemeIcon(config.icon, new vscode.ThemeColor(config.color));
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

