import * as path from 'path';
import * as vscode from 'vscode';
import { GitChange, GitChangeStatus, GitChangeStage } from './types';

/**
 * Icon configuration for each git change status
 */
interface StatusIconConfig {
    icon: string;
    color: string;
}

/**
 * Icons for staged changes - use check-related icons with green/cyan colors
 * These appear distinctly different from unstaged changes
 */
const STAGED_ICON_MAP: Record<GitChangeStatus, StatusIconConfig> = {
    'modified': { icon: 'diff-modified', color: 'terminal.ansiGreen' },
    'added': { icon: 'diff-added', color: 'terminal.ansiGreen' },
    'deleted': { icon: 'diff-removed', color: 'terminal.ansiGreen' },
    'renamed': { icon: 'diff-renamed', color: 'terminal.ansiGreen' },
    'copied': { icon: 'diff-added', color: 'terminal.ansiGreen' },
    'untracked': { icon: 'diff-added', color: 'terminal.ansiGreen' },
    'ignored': { icon: 'diff-ignored', color: 'terminal.ansiGreen' },
    'conflict': { icon: 'diff-modified', color: 'terminal.ansiGreen' }
};

/**
 * Icons for unstaged changes - use orange/yellow colors
 */
const UNSTAGED_ICON_MAP: Record<GitChangeStatus, StatusIconConfig> = {
    'modified': { icon: 'edit', color: 'terminal.ansiYellow' },
    'added': { icon: 'add', color: 'terminal.ansiYellow' },
    'deleted': { icon: 'trash', color: 'terminal.ansiRed' },
    'renamed': { icon: 'arrow-right', color: 'terminal.ansiYellow' },
    'copied': { icon: 'copy', color: 'terminal.ansiYellow' },
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
 * Stage prefix for description - makes stage very clear
 */
const STAGE_PREFIX: Record<GitChangeStage, string> = {
    'staged': '\u2713',      // ✓ checkmark
    'unstaged': '\u25CB',    // ○ circle
    'untracked': '?'         // ? question mark
};

/**
 * Tree item for displaying a git change in the tree view
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

        // Status-specific icon with color
        this.iconPath = this.getStatusIcon();

        // Command to open diff review view with inline commenting
        this.command = {
            command: 'gitDiffComments.openWithReview',
            title: 'Open Diff Review',
            arguments: [this]
        };

        // Resource URI for file decorations
        this.resourceUri = change.uri;
    }

    /**
     * Get the status icon with appropriate color based on stage
     * Staged: green diff-* icons
     * Unstaged: yellow/orange edit-style icons
     * Untracked: magenta question icon
     */
    private getStatusIcon(): vscode.ThemeIcon {
        const iconMap = this.change.stage === 'staged' ? STAGED_ICON_MAP : UNSTAGED_ICON_MAP;
        const config = iconMap[this.change.status];
        return new vscode.ThemeIcon(config.icon, new vscode.ThemeColor(config.color));
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

