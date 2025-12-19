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

        // Icon for commit
        this.iconPath = new vscode.ThemeIcon('git-commit');

        // Command to show commit diff
        this.command = {
            command: 'git.viewCommit',
            title: 'View Commit',
            arguments: [commit.hash]
        };
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
     */
    private createTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.supportHtml = true;

        // Commit hash
        md.appendMarkdown(`**Commit:** \`${this.commit.hash}\`\n\n`);

        // Full subject
        md.appendMarkdown(`**Message:** ${this.commit.subject}\n\n`);

        // Author
        md.appendMarkdown(`**Author:** ${this.commit.authorName} <${this.commit.authorEmail}>\n\n`);

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

        // Repository
        md.appendMarkdown(`**Repository:** ${this.commit.repositoryName}\n\n`);

        md.appendMarkdown('---\n\n');
        md.appendMarkdown('*Click to view commit details*');

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

