/**
 * Tree items for queued tasks in the AI Processes panel
 *
 * Displays queued tasks from AIQueueService in the tree view.
 */

import * as vscode from 'vscode';
import { QueuedTask, TaskPriority } from '@plusplusoneplusplus/pipeline-core';

/**
 * Tree item representing a queued task
 */
export class QueuedTaskItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly task: QueuedTask;
    public readonly position: number;

    constructor(task: QueuedTask, position: number) {
        // Create label from display name or task type
        const label = task.displayName || `${task.type} task`;

        super(label, vscode.TreeItemCollapsibleState.None);

        this.task = task;
        this.position = position;

        // Context value includes priority for conditional menu items
        this.contextValue = `queuedTask_${task.priority}`;

        // Set description with position
        this.description = this.getDescription(task, position);

        // Set icon based on priority
        this.iconPath = this.getPriorityIcon(task.priority);

        // Set tooltip with full details
        this.tooltip = this.createTooltip(task, position);
    }

    /**
     * Get description showing position and priority
     */
    private getDescription(task: QueuedTask, position: number): string {
        const positionText = `#${position}`;
        const elapsed = this.formatDuration(Date.now() - task.createdAt);

        if (task.priority === 'high') {
            return `${positionText} · high priority · waiting ${elapsed}`;
        } else if (task.priority === 'low') {
            return `${positionText} · low priority · waiting ${elapsed}`;
        }
        return `${positionText} · waiting ${elapsed}`;
    }

    /**
     * Get icon based on priority
     */
    private getPriorityIcon(priority: TaskPriority): vscode.ThemeIcon {
        switch (priority) {
            case 'high':
                return new vscode.ThemeIcon('flame', new vscode.ThemeColor('charts.orange'));
            case 'low':
                return new vscode.ThemeIcon('arrow-down', new vscode.ThemeColor('disabledForeground'));
            default:
                return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.blue'));
        }
    }

    /**
     * Create detailed tooltip
     */
    private createTooltip(task: QueuedTask, position: number): vscode.MarkdownString {
        const lines: string[] = [];

        // Header
        lines.push('📋 **Queued Task**');
        lines.push('');

        // Display name if set
        if (task.displayName) {
            lines.push(`**Name:** ${task.displayName}`);
        }

        // Task type
        lines.push(`**Type:** ${task.type}`);

        // Priority
        const priorityEmoji = this.getPriorityEmoji(task.priority);
        lines.push(`**Priority:** ${priorityEmoji} ${task.priority}`);

        // Position
        lines.push(`**Position:** #${position} in queue`);
        lines.push('');

        // Timing
        const createdDate = new Date(task.createdAt);
        lines.push(`**Queued At:** ${createdDate.toLocaleString()}`);
        const elapsed = this.formatDuration(Date.now() - task.createdAt);
        lines.push(`**Waiting:** ${elapsed}`);

        // Task ID
        lines.push('');
        lines.push(`**ID:** \`${task.id}\``);

        const tooltip = new vscode.MarkdownString(lines.join('\n'));
        tooltip.supportHtml = true;
        return tooltip;
    }

    /**
     * Get emoji for priority
     */
    private getPriorityEmoji(priority: TaskPriority): string {
        switch (priority) {
            case 'high':
                return '🔥';
            case 'low':
                return '↓';
            default:
                return '○';
        }
    }

    /**
     * Format duration in human readable format
     */
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    }
}

/**
 * Section header item for "Queued Tasks" group
 */
export class QueuedTasksSectionItem extends vscode.TreeItem {
    public readonly contextValue = 'queuedTasksSection';

    constructor(count: number, isPaused: boolean) {
        let label: string;
        if (isPaused) {
            label = count > 0 ? `Queued Tasks (${count}, paused)` : 'Queued Tasks (paused)';
        } else {
            label = count > 0 ? `Queued Tasks (${count})` : 'Queued Tasks';
        }

        super(label, vscode.TreeItemCollapsibleState.Expanded);

        // Icon changes when paused
        this.iconPath = isPaused
            ? new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.yellow'))
            : new vscode.ThemeIcon('list-ordered');

        this.description = '';

        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown('**Task Queue**\n\n');
        if (isPaused) {
            tooltip.appendMarkdown('⏸️ Queue is **paused**. No new tasks will start.\n\n');
        }
        tooltip.appendMarkdown('Tasks waiting to be executed by AI.\n\n');
        tooltip.appendMarkdown('Right-click for queue management options.');
        this.tooltip = tooltip;
    }
}
