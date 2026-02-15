/**
 * AI Queue Commands
 *
 * Command handlers for the AI task queue system.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getAIQueueService } from './ai-queue-service';
import { getExtensionLogger, LogCategory } from './ai-service-logger';
import { QueueJobDialogService } from './queue-job-dialog-service';
import { QueuedTaskItem } from './queued-task-tree-item';
import { getSkills } from '../shared/skill-files-utils';
import { getWorkspaceRoot } from '../shared/workspace-utils';
import { DEFAULT_AI_TIMEOUT_MS } from '../shared/ai-timeouts';

/**
 * Extract task ID from argument (can be string, QueuedTaskItem, or undefined)
 */
function extractTaskId(arg: string | QueuedTaskItem | undefined): string | undefined {
    if (!arg) {
        return undefined;
    }
    if (typeof arg === 'string') {
        return arg;
    }
    if (arg instanceof QueuedTaskItem) {
        return arg.task.id;
    }
    return undefined;
}

/**
 * Register all queue-related commands
 */
export function registerQueueCommands(context: vscode.ExtensionContext): void {
    const logger = getExtensionLogger();

    const safeRegister = (commandId: string, handler: (...args: any[]) => any): void => {
        try {
            context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
        } catch (error) {
            logger.warn(LogCategory.AI, `Command already registered: ${commandId}`);
        }
    };

    // Pause queue
    safeRegister('shortcuts.queue.pauseQueue', () => {
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
    });

    // Resume queue
    safeRegister('shortcuts.queue.resumeQueue', () => {
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
    });

    // Clear queue
    safeRegister('shortcuts.queue.clearQueue', async () => {
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
    });

    // Cancel task
    safeRegister('shortcuts.queue.cancelTask', async (arg?: string | QueuedTaskItem) => {
        const queueService = getAIQueueService();
        if (!queueService) {
            vscode.window.showWarningMessage('Queue service not initialized');
            return;
        }

        let taskId = extractTaskId(arg);

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
    });

    // Move to top
    safeRegister('shortcuts.queue.moveToTop', async (arg?: string | QueuedTaskItem) => {
        const queueService = getAIQueueService();
        if (!queueService) {
            vscode.window.showWarningMessage('Queue service not initialized');
            return;
        }

        let taskId = extractTaskId(arg);

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
    });

    // Move up
    safeRegister('shortcuts.queue.moveUp', (arg?: string | QueuedTaskItem) => {
        const queueService = getAIQueueService();
        if (!queueService) {
            vscode.window.showWarningMessage('Queue service not initialized');
            return;
        }

        const taskId = extractTaskId(arg);
        if (!taskId) {
            vscode.window.showWarningMessage('No task specified');
            return;
        }

        if (queueService.moveUp(taskId)) {
            logger.info(LogCategory.AI, `Moved task up: ${taskId}`);
        }
    });

    // Move down
    safeRegister('shortcuts.queue.moveDown', (arg?: string | QueuedTaskItem) => {
        const queueService = getAIQueueService();
        if (!queueService) {
            vscode.window.showWarningMessage('Queue service not initialized');
            return;
        }

        const taskId = extractTaskId(arg);
        if (!taskId) {
            vscode.window.showWarningMessage('No task specified');
            return;
        }

        if (queueService.moveDown(taskId)) {
            logger.info(LogCategory.AI, `Moved task down: ${taskId}`);
        }
    });

    // Add job via dialog
    safeRegister('shortcuts.queue.addJob', async () => {
        const queueService = getAIQueueService();
        if (!queueService) {
            vscode.window.showWarningMessage('Queue service not initialized');
            return;
        }

        if (!queueService.isEnabled()) {
            vscode.window.showWarningMessage(
                'Queue feature is disabled. Enable it in settings: workspaceShortcuts.queue.enabled'
            );
            return;
        }

        const dialogService = new QueueJobDialogService(context.extensionUri, context);
        const dialogResult = await dialogService.showDialog();

        if (dialogResult.cancelled || !dialogResult.options) {
            return;
        }

        const options = dialogResult.options;
        const workspaceRoot = getWorkspaceRoot();

        let promptFilePath: string | undefined;
        let promptContent: string | undefined;
        let displayName: string;
        let skillName: string | undefined;
        let additionalContext: string | undefined;

        if (options.mode === 'prompt') {
            // Store freeform prompt directly in payload (no temp file needed for SDK)
            promptContent = options.prompt!;
            displayName = 'Queue Job: Prompt';
        } else {
            // Skill mode: resolve the skill's prompt file path
            const skills = await getSkills(workspaceRoot || undefined);
            const skill = skills.find(s => s.name === options.skillName);

            if (!skill) {
                vscode.window.showErrorMessage(`Skill not found: ${options.skillName}`);
                return;
            }

            // Find the prompt file (prompt.md or SKILL.md)
            promptFilePath = path.join(skill.absolutePath, 'prompt.md');
            if (!fs.existsSync(promptFilePath)) {
                promptFilePath = path.join(skill.absolutePath, 'SKILL.md');
                if (!fs.existsSync(promptFilePath)) {
                    vscode.window.showErrorMessage(`No prompt file found for skill: ${options.skillName}`);
                    return;
                }
            }

            skillName = options.skillName;
            additionalContext = options.additionalContext;
            displayName = `Queue Job: Skill (${options.skillName})`;
        }

        const result = queueService.queueTask({
            type: 'follow-prompt',
            payload: {
                promptFilePath,
                promptContent,
                skillName,
                additionalContext,
                workingDirectory: options.workingDirectory || workspaceRoot || undefined,
                model: options.model,
            },
            displayName,
            config: {
                model: options.model,
                timeoutMs: DEFAULT_AI_TIMEOUT_MS,
            },
        });

        logger.info(LogCategory.AI, `Queued job: ${displayName} at position #${result.position}`);
        vscode.window.showInformationMessage(
            `Queued AI job (#${result.position}): ${displayName}`
        );
    });
}
