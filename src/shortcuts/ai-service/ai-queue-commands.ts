/**
 * AI Queue Commands
 *
 * Command handlers for the AI task queue system.
 */

import * as vscode from 'vscode';
import { getAIQueueService } from './ai-queue-service';
import { getExtensionLogger, LogCategory } from './ai-service-logger';

/**
 * Register all queue-related commands
 */
export function registerQueueCommands(context: vscode.ExtensionContext): void {
    const logger = getExtensionLogger();

    // Pause queue
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.queue.pauseQueue', () => {
            const queueService = getAIQueueService();
            if (!queueService) {
                vscode.window.showWarningMessage('Queue service not initialized');
                return;
            }

            if (queueService.isPaused()) {
                vscode.window.showInformationMessage('Queue is already paused');
                return;
            }

            queueService.pause();
            logger.info(LogCategory.AI, 'Queue paused');
            vscode.window.showInformationMessage('Queue paused. Running tasks will complete, but no new tasks will start.');
        })
    );

    // Resume queue
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.queue.resumeQueue', () => {
            const queueService = getAIQueueService();
            if (!queueService) {
                vscode.window.showWarningMessage('Queue service not initialized');
                return;
            }

            if (!queueService.isPaused()) {
                vscode.window.showInformationMessage('Queue is already running');
                return;
            }

            queueService.resume();
            logger.info(LogCategory.AI, 'Queue resumed');
            vscode.window.showInformationMessage('Queue resumed. Tasks will continue processing.');
        })
    );

    // Clear queue
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.queue.clearQueue', async () => {
            const queueService = getAIQueueService();
            if (!queueService) {
                vscode.window.showWarningMessage('Queue service not initialized');
                return;
            }

            const stats = queueService.getStats();
            if (stats.queued === 0) {
                vscode.window.showInformationMessage('Queue is already empty');
                return;
            }

            const answer = await vscode.window.showWarningMessage(
                `Clear ${stats.queued} queued task(s)? Running tasks will continue.`,
                { modal: true },
                'Clear Queue'
            );

            if (answer === 'Clear Queue') {
                queueService.clearQueue();
                logger.info(LogCategory.AI, `Cleared ${stats.queued} queued tasks`);
                vscode.window.showInformationMessage('Queue cleared');
            }
        })
    );

    // Cancel task
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.queue.cancelTask', async (taskId?: string) => {
            const queueService = getAIQueueService();
            if (!queueService) {
                vscode.window.showWarningMessage('Queue service not initialized');
                return;
            }

            // If no taskId provided, show picker
            if (!taskId) {
                const queuedTasks = queueService.getQueuedTasks();
                const runningTasks = queueService.getRunningTasks();
                const allTasks = [...runningTasks, ...queuedTasks];

                if (allTasks.length === 0) {
                    vscode.window.showInformationMessage('No tasks to cancel');
                    return;
                }

                const items = allTasks.map(task => ({
                    label: task.displayName || task.type,
                    description: task.status === 'running' ? '$(sync~spin) Running' : `#${queueService.getPosition(task.id)} in queue`,
                    taskId: task.id,
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a task to cancel',
                });

                if (!selected) {
                    return;
                }

                taskId = selected.taskId;
            }

            queueService.cancelTask(taskId);
            logger.info(LogCategory.AI, `Cancelled task: ${taskId}`);
            vscode.window.showInformationMessage('Task cancelled');
        })
    );

    // Move to top
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.queue.moveToTop', async (taskId?: string) => {
            const queueService = getAIQueueService();
            if (!queueService) {
                vscode.window.showWarningMessage('Queue service not initialized');
                return;
            }

            // If no taskId provided, show picker
            if (!taskId) {
                const queuedTasks = queueService.getQueuedTasks();

                if (queuedTasks.length <= 1) {
                    vscode.window.showInformationMessage('No tasks to reorder');
                    return;
                }

                const items = queuedTasks.slice(1).map(task => ({
                    label: task.displayName || task.type,
                    description: `#${queueService.getPosition(task.id)} in queue`,
                    taskId: task.id,
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a task to move to top',
                });

                if (!selected) {
                    return;
                }

                taskId = selected.taskId;
            }

            if (queueService.moveToTop(taskId)) {
                logger.info(LogCategory.AI, `Moved task to top: ${taskId}`);
                vscode.window.showInformationMessage('Task moved to top of queue');
            }
        })
    );

    // Move up
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.queue.moveUp', (taskId?: string) => {
            const queueService = getAIQueueService();
            if (!queueService) {
                vscode.window.showWarningMessage('Queue service not initialized');
                return;
            }

            if (!taskId) {
                vscode.window.showWarningMessage('No task specified');
                return;
            }

            if (queueService.moveUp(taskId)) {
                logger.info(LogCategory.AI, `Moved task up: ${taskId}`);
            }
        })
    );

    // Move down
    context.subscriptions.push(
        vscode.commands.registerCommand('shortcuts.queue.moveDown', (taskId?: string) => {
            const queueService = getAIQueueService();
            if (!queueService) {
                vscode.window.showWarningMessage('Queue service not initialized');
                return;
            }

            if (!taskId) {
                vscode.window.showWarningMessage('No task specified');
                return;
            }

            if (queueService.moveDown(taskId)) {
                logger.info(LogCategory.AI, `Moved task down: ${taskId}`);
            }
        })
    );
}
