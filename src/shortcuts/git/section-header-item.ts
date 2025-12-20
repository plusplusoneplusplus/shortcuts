import * as vscode from 'vscode';
import { GitSectionType } from './types';

/**
 * Tree item representing a section header in the Git view
 * Used for "Changes" and "Commits" sections
 */
export class SectionHeaderItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue: string;

    /**
     * The section type this header represents
     */
    public readonly sectionType: GitSectionType;

    /**
     * Create a new section header
     * @param sectionType The type of section ('changes', 'commits', or 'comments')
     * @param count Number of items in this section
     * @param hasMore Whether there are more items available (for pagination)
     */
    constructor(
        sectionType: GitSectionType,
        count: number,
        hasMore: boolean = false
    ) {
        const label = sectionType === 'changes' ? 'Changes' : 
                     sectionType === 'commits' ? 'Commits' : 'Comments';
        
        // Start expanded by default
        super(label, vscode.TreeItemCollapsibleState.Expanded);

        this.sectionType = sectionType;
        this.contextValue = `gitSection_${sectionType}`;

        // Show count in description, with "+" if there are more
        if (count > 0) {
            this.description = hasMore ? `${count}+` : `${count}`;
        } else {
            this.description = '0';
        }

        // Set appropriate icon for each section
        this.iconPath = this.getSectionIcon();

        // Set tooltip
        this.tooltip = this.createTooltip(count, hasMore);
    }

    /**
     * Get the icon for this section
     */
    private getSectionIcon(): vscode.ThemeIcon {
        if (this.sectionType === 'changes') {
            return new vscode.ThemeIcon('git-compare');
        } else if (this.sectionType === 'commits') {
            return new vscode.ThemeIcon('history');
        } else {
            return new vscode.ThemeIcon('comment-discussion');
        }
    }

    /**
     * Create tooltip for this section
     */
    private createTooltip(count: number, hasMore: boolean): string {
        if (this.sectionType === 'changes') {
            if (count === 0) {
                return 'No uncommitted changes';
            }
            return `${count} uncommitted change${count === 1 ? '' : 's'}`;
        } else if (this.sectionType === 'commits') {
            if (count === 0) {
                return 'No commits in history';
            }
            const moreText = hasMore ? ' (more available)' : '';
            return `${count} commit${count === 1 ? '' : 's'} loaded${moreText}`;
        } else {
            if (count === 0) {
                return 'No comments on changes';
            }
            return `${count} comment${count === 1 ? '' : 's'} on staged/unstaged changes`;
        }
    }
}

