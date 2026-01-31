/**
 * AI Queue Status Bar Item
 *
 * Shows queue status in the VS Code status bar.
 * Displays count of queued tasks and spinning icon when executing.
 */

import * as vscode from 'vscode';
import { AIQueueService } from './ai-queue-service';

/**
 * Status bar item for the AI task queue
 */
export class AIQueueStatusBarItem implements vscode.Disposable {
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly queueService: AIQueueService;
    private readonly disposables: vscode.Disposable[] = [];
    private updateInterval?: NodeJS.Timeout;

    constructor(queueService: AIQueueService) {
        this.queueService = queueService;

        // Create status bar item (right side, lower priority = further right)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'workbench.view.extension.shortcuts';
        this.statusBarItem.tooltip = 'AI Task Queue - Click to view';

        // Listen for queue changes
        this.disposables.push(
            queueService.onDidChangeStats(() => {
                this.update();
            })
        );

        // Initial update
        this.update();

        // Update every second when there are running tasks (for spinner animation)
        this.startUpdateInterval();
    }

    /**
     * Update the status bar item
     */
    private update(): void {
        const stats = this.queueService.getStats();
        const { queued, running } = stats;

        if (queued === 0 && running === 0) {
            // Hide when nothing is queued or running
            this.statusBarItem.hide();
            return;
        }

        // Build text
        let text = '';
        let tooltip = 'AI Task Queue';

        if (running > 0) {
            // Show spinning icon when running
            text = `$(sync~spin) ${running} running`;
            tooltip = `${running} task(s) running`;

            if (queued > 0) {
                text += `, ${queued} queued`;
                tooltip += `, ${queued} queued`;
            }
        } else if (queued > 0) {
            if (stats.isPaused) {
                text = `$(debug-pause) ${queued} queued (paused)`;
                tooltip = `${queued} task(s) queued (queue paused)`;
            } else {
                text = `$(list-ordered) ${queued} queued`;
                tooltip = `${queued} task(s) queued`;
            }
        }

        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = tooltip;
        this.statusBarItem.show();
    }

    /**
     * Start the update interval for spinner animation
     */
    private startUpdateInterval(): void {
        // Update every second to keep spinner animated
        this.updateInterval = setInterval(() => {
            const stats = this.queueService.getStats();
            if (stats.running > 0) {
                this.update();
            }
        }, 1000);
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.statusBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

/**
 * Create and return a queue status bar item
 */
export function createQueueStatusBarItem(queueService: AIQueueService): AIQueueStatusBarItem {
    return new AIQueueStatusBarItem(queueService);
}
