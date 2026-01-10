/**
 * Tree data provider for the AI Processes panel
 * 
 * Provides a tree view of running and completed AI processes.
 */

import * as vscode from 'vscode';
import { AIProcessManager } from './ai-process-manager';
import { AIProcess } from './types';

/**
 * Tree item representing an AI process
 */
export class AIProcessItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly process: AIProcess;

    constructor(process: AIProcess) {
        const label = process.promptPreview;
        super(label, vscode.TreeItemCollapsibleState.None);

        this.process = process;

        // Different context value for different process types
        if (process.type === 'code-review') {
            this.contextValue = `codeReviewProcess_${process.status}`;
        } else if (process.type === 'discovery') {
            this.contextValue = `discoveryProcess_${process.status}`;
        } else {
            this.contextValue = `clarificationProcess_${process.status}`;
        }

        // Set description based on status
        this.description = this.getStatusDescription(process);

        // Set icon based on status and type
        this.iconPath = this.getStatusIcon(process);

        // Set tooltip with full details
        this.tooltip = this.createTooltip(process);

        // Click to view full details - different command for code reviews
        if (process.type === 'code-review' && process.status === 'completed') {
            this.command = {
                command: 'clarificationProcesses.viewCodeReviewDetails',
                title: 'View Code Review',
                arguments: [this]
            };
        } else {
            this.command = {
                command: 'clarificationProcesses.viewDetails',
                title: 'View Details',
                arguments: [this]
            };
        }
    }

    /**
     * Get status description (elapsed time for running, duration for completed)
     */
    private getStatusDescription(process: AIProcess): string {
        if (process.status === 'running') {
            const elapsed = this.formatDuration(Date.now() - process.startTime.getTime());
            return `running (${elapsed})`;
        }

        if (process.endTime) {
            const duration = this.formatDuration(process.endTime.getTime() - process.startTime.getTime());
            return `${process.status} (${duration})`;
        }

        return process.status;
    }

    /**
     * Get icon based on status and type
     */
    private getStatusIcon(process: AIProcess): vscode.ThemeIcon {
        // For code reviews, use checklist icon with status color
        if (process.type === 'code-review') {
            switch (process.status) {
                case 'running':
                    return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
                case 'completed':
                    // Check if we have structured result with assessment
                    if (process.structuredResult) {
                        try {
                            const result = JSON.parse(process.structuredResult);
                            if (result.summary?.overallAssessment === 'pass') {
                                return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
                            } else if (result.summary?.overallAssessment === 'fail') {
                                return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
                            } else {
                                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
                            }
                        } catch {
                            // Fall through to default
                        }
                    }
                    return new vscode.ThemeIcon('checklist', new vscode.ThemeColor('charts.green'));
                case 'failed':
                    return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
                case 'cancelled':
                    return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.orange'));
                default:
                    return new vscode.ThemeIcon('checklist');
            }
        }

        // Icons for discovery processes
        if (process.type === 'discovery') {
            switch (process.status) {
                case 'running':
                    return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
                case 'completed':
                    return new vscode.ThemeIcon('search', new vscode.ThemeColor('charts.green'));
                case 'failed':
                    return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
                case 'cancelled':
                    return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.orange'));
                default:
                    return new vscode.ThemeIcon('search');
            }
        }

        // Default icons for clarification processes
        switch (process.status) {
            case 'running':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
            case 'completed':
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            case 'cancelled':
                return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.orange'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    /**
     * Create detailed tooltip
     */
    private createTooltip(process: AIProcess): vscode.MarkdownString {
        const lines: string[] = [];

        // Type indicator
        if (process.type === 'code-review') {
            lines.push('📋 **Code Review**');
        } else if (process.type === 'discovery') {
            lines.push('🔍 **Auto Discovery**');
        } else {
            lines.push('💬 **AI Clarification**');
        }
        lines.push('');

        // Status
        const statusEmoji = this.getStatusEmoji(process.status);
        lines.push(`**Status:** ${statusEmoji} ${process.status}`);
        lines.push('');

        // Code review specific info
        if (process.type === 'code-review' && process.codeReviewMetadata) {
            const meta = process.codeReviewMetadata;
            if (meta.commitSha) {
                lines.push(`**Commit:** \`${meta.commitSha.substring(0, 7)}\``);
                if (meta.commitMessage) {
                    lines.push(`**Message:** ${meta.commitMessage}`);
                }
            } else {
                lines.push(`**Type:** ${meta.reviewType === 'pending' ? 'Pending Changes' : 'Staged Changes'}`);
            }
            if (meta.diffStats) {
                lines.push(`**Changes:** ${meta.diffStats.files} files, +${meta.diffStats.additions}/-${meta.diffStats.deletions}`);
            }
            if (meta.rulesUsed.length === 1) {
                lines.push(`**Rule:** ${meta.rulesUsed[0]}`);
            } else if (meta.rulesUsed.length <= 3) {
                lines.push(`**Rules:** ${meta.rulesUsed.join(', ')}`);
            } else {
                // For many rules, show first 3 with count of remaining
                const shown = meta.rulesUsed.slice(0, 3).join(', ');
                const remaining = meta.rulesUsed.length - 3;
                lines.push(`**Rules:** ${shown} (+${remaining} more)`);
            }
            lines.push('');

            // Show summary if completed
            if (process.structuredResult) {
                try {
                    const result = JSON.parse(process.structuredResult);
                    if (result.summary) {
                        const assessmentEmoji = result.summary.overallAssessment === 'pass' ? '✅' :
                            result.summary.overallAssessment === 'fail' ? '❌' : '⚠️';
                        lines.push(`**Result:** ${assessmentEmoji} ${result.summary.overallAssessment.toUpperCase()}`);
                        lines.push(`**Findings:** ${result.summary.totalFindings} issue(s)`);
                        lines.push('');
                    }
                } catch {
                    // Ignore parse errors
                }
            }
        }

        // Discovery specific info
        if (process.type === 'discovery' && process.discoveryMetadata) {
            const meta = process.discoveryMetadata;
            lines.push(`**Feature:** ${meta.featureDescription}`);
            if (meta.keywords && meta.keywords.length > 0) {
                lines.push(`**Keywords:** ${meta.keywords.join(', ')}`);
            }
            if (meta.targetGroupPath) {
                lines.push(`**Target Group:** ${meta.targetGroupPath}`);
            }
            if (meta.scope) {
                const scopeParts: string[] = [];
                if (meta.scope.includeSourceFiles) scopeParts.push('source');
                if (meta.scope.includeDocs) scopeParts.push('docs');
                if (meta.scope.includeConfigFiles) scopeParts.push('config');
                if (meta.scope.includeGitHistory) scopeParts.push('git');
                lines.push(`**Scope:** ${scopeParts.join(', ')}`);
            }
            if (meta.resultCount !== undefined) {
                lines.push(`**Results:** ${meta.resultCount} item(s) found`);
            }
            lines.push('');
        }

        // Timing
        lines.push(`**Started:** ${process.startTime.toLocaleString()}`);
        if (process.endTime) {
            lines.push(`**Ended:** ${process.endTime.toLocaleString()}`);
            const duration = this.formatDuration(process.endTime.getTime() - process.startTime.getTime());
            lines.push(`**Duration:** ${duration}`);
        } else {
            const elapsed = this.formatDuration(Date.now() - process.startTime.getTime());
            lines.push(`**Elapsed:** ${elapsed}`);
        }
        lines.push('');

        // Error if any
        if (process.error) {
            lines.push(`**Error:** ${process.error}`);
            lines.push('');
        }

        // Prompt preview (only for clarification, discovery shows feature description above)
        if (process.type === 'clarification') {
            lines.push('**Prompt:**');
            lines.push(`> ${process.promptPreview}`);
        }

        const tooltip = new vscode.MarkdownString(lines.join('\n'));
        tooltip.supportHtml = true;
        return tooltip;
    }

    /**
     * Get emoji for status
     */
    private getStatusEmoji(status: string): string {
        switch (status) {
            case 'running': return '🔄';
            case 'completed': return '✅';
            case 'failed': return '❌';
            case 'cancelled': return '🚫';
            default: return '○';
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
 * Tree data provider for AI processes
 */
export class AIProcessTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private processManager: AIProcessManager;
    private disposables: vscode.Disposable[] = [];
    private refreshInterval?: NodeJS.Timeout;

    constructor(processManager: AIProcessManager) {
        this.processManager = processManager;

        // Listen for process changes
        this.disposables.push(
            processManager.onDidChangeProcesses(() => {
                this.refresh();
            })
        );

        // Refresh every second to update elapsed times for running processes
        this.refreshInterval = setInterval(() => {
            if (this.processManager.hasRunningProcesses()) {
                this._onDidChangeTreeData.fire();
            }
        }, 1000);
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children - returns all processes (no hierarchy)
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        // Only root level - no nested items
        if (element) {
            return [];
        }

        const processes = this.processManager.getProcesses();

        // Sort: running first, then by start time (newest first)
        processes.sort((a, b) => {
            if (a.status === 'running' && b.status !== 'running') {
                return -1;
            }
            if (a.status !== 'running' && b.status === 'running') {
                return 1;
            }
            return b.startTime.getTime() - a.startTime.getTime();
        });

        return processes.map(p => new AIProcessItem(p));
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this._onDidChangeTreeData.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

