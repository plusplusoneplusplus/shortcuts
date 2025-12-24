import * as vscode from 'vscode';
import { GitChangeStage } from './types';

/**
 * Tree item representing a sub-section within the Changes section
 * Used to visually separate staged, unstaged, and untracked changes
 */
export class StageSectionItem extends vscode.TreeItem {
    /**
     * Context value for menu contributions
     */
    public readonly contextValue: string;

    /**
     * The stage type this section represents
     */
    public readonly stageType: GitChangeStage;

    /**
     * Create a new stage section header
     * @param stageType The type of stage ('staged', 'unstaged', or 'untracked')
     * @param count Number of items in this section
     */
    constructor(
        stageType: GitChangeStage,
        count: number
    ) {
        const label = stageType === 'staged' ? 'Staged Changes' : 
                     stageType === 'unstaged' ? 'Changes' : 'Untracked Files';
        
        // Start expanded by default
        super(label, vscode.TreeItemCollapsibleState.Expanded);

        this.stageType = stageType;
        this.contextValue = `gitStageSection_${stageType}`;

        // Show count in description
        this.description = `${count}`;

        // Set appropriate icon for each stage section
        this.iconPath = this.getSectionIcon();

        // Set tooltip
        this.tooltip = this.createTooltip(count);
    }

    /**
     * Get the icon for this section
     */
    private getSectionIcon(): vscode.ThemeIcon {
        if (this.stageType === 'staged') {
            // Green checkmark for staged changes
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
        } else if (this.stageType === 'unstaged') {
            // Orange/yellow circle for modified (unstaged) changes
            return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
        } else {
            // Question mark for untracked files
            return new vscode.ThemeIcon('question', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'));
        }
    }

    /**
     * Create tooltip for this section
     */
    private createTooltip(count: number): string {
        if (this.stageType === 'staged') {
            return `${count} staged change${count === 1 ? '' : 's'} ready to commit`;
        } else if (this.stageType === 'unstaged') {
            return `${count} modified file${count === 1 ? '' : 's'} not staged for commit`;
        } else {
            return `${count} untracked file${count === 1 ? '' : 's'}`;
        }
    }
}

