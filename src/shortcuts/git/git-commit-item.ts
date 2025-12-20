import * as vscode from 'vscode';
import { GitCommit } from './types';

/**
 * Maximum length for commit subject in the label
 */
const MAX_SUBJECT_LENGTH = 50;

/**
 * Tree item for displaying a git commit in the tree view
 */
export class GitCommitItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue = 'gitCommit';

    /**
     * The commit this item represents
     */
    public readonly commit: GitCommit;

    /**
     * Create a new commit tree item
     * @param commit The git commit to display
     */
    constructor(commit: GitCommit) {
        // Label: "abc1234 Fix bug in parser"
        const truncatedSubject = commit.subject.length > MAX_SUBJECT_LENGTH
            ? commit.subject.substring(0, MAX_SUBJECT_LENGTH - 3) + '...'
            : commit.subject;
        const label = `${commit.shortHash} ${truncatedSubject}`;

        super(label, vscode.TreeItemCollapsibleState.Collapsed);

        this.commit = commit;

        // Description: "John Doe • 2 hours ago (main, origin/main)"
        this.description = this.createDescription();

        // Tooltip with full details
        this.tooltip = this.createTooltip();

        // Icon for commit - use different color for unpushed commits
        if (commit.isAheadOfRemote) {
            // Green color for unpushed commits (ahead of remote)
            this.iconPath = new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('terminal.ansiGreen'));
        } else {
            this.iconPath = new vscode.ThemeIcon('git-commit');
        }

        // No command - clicking should expand/collapse the commit to show files
        // The expand/collapse is handled automatically by VSCode TreeView
    }

    /**
     * Create the description text showing author and time
     */
    private createDescription(): string {
        const parts: string[] = [];

        // Author name
        parts.push(this.commit.authorName);

        // Relative date
        parts.push(this.commit.relativeDate);

        // Refs (branches/tags) if any
        if (this.commit.refs.length > 0) {
            // Filter out HEAD references for cleaner display
            const displayRefs = this.commit.refs
                .filter(ref => !ref.startsWith('HEAD'))
                .map(ref => {
                    // Shorten common prefixes
                    if (ref.startsWith('origin/')) {
                        return ref;
                    }
                    return ref;
                })
                .slice(0, 3); // Limit to 3 refs

            if (displayRefs.length > 0) {
                parts.push(`(${displayRefs.join(', ')})`);
            }
        }

        return parts.join(' • ');
    }

    /**
     * Create detailed tooltip with markdown
     * The tooltip is interactive - hovering over it keeps it visible
     */
    private createTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;
        // Enable trusted mode to allow command links for copying
        md.isTrusted = true;

        // Commit hash with copy link
        const copyHashArgs = encodeURIComponent(JSON.stringify([this.commit.hash]));
        md.appendMarkdown(`**Commit:** \`${this.commit.hash}\` `);
        md.appendMarkdown(`[📋 Copy](command:gitView.copyCommitHash?${copyHashArgs} "Copy commit hash")\n\n`);

        // Full subject with copy link
        const copyMsgArgs = encodeURIComponent(JSON.stringify([this.commit.subject]));
        md.appendMarkdown(`**Message:** ${this.commit.subject} `);
        md.appendMarkdown(`[📋](command:gitView.copyToClipboard?${copyMsgArgs} "Copy message")\n\n`);

        // Author with copy link
        const authorInfo = `${this.commit.authorName} <${this.commit.authorEmail}>`;
        const copyAuthorArgs = encodeURIComponent(JSON.stringify([authorInfo]));
        md.appendMarkdown(`**Author:** ${authorInfo} `);
        md.appendMarkdown(`[📋](command:gitView.copyToClipboard?${copyAuthorArgs} "Copy author")\n\n`);

        // Date
        md.appendMarkdown(`**Date:** ${this.commit.relativeDate} (${this.formatDate(this.commit.date)})\n\n`);

        // Refs
        if (this.commit.refs.length > 0) {
            md.appendMarkdown(`**Refs:** ${this.commit.refs.join(', ')}\n\n`);
        }

        // Parent commits (for merge detection)
        if (this.commit.parentHashes) {
            const parents = this.commit.parentHashes.split(' ').filter(p => p);
            if (parents.length > 1) {
                md.appendMarkdown(`**Merge commit** (${parents.length} parents)\n\n`);
            }
        }

        // Unpushed indicator
        if (this.commit.isAheadOfRemote) {
            md.appendMarkdown(`**Status:** 🟢 Unpushed (ahead of remote)\n\n`);
        }

        md.appendMarkdown('---\n\n');
        md.appendMarkdown('*Click to expand and view changed files*');

        return md;
    }

    /**
     * Format an ISO date string to a human-readable format
     */
    private formatDate(isoDate: string): string {
        try {
            const date = new Date(isoDate);
            return date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return isoDate;
        }
    }
}

