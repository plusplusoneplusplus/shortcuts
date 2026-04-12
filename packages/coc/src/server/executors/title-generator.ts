/**
 * Title Generator
 *
 * Fire-and-forget title generation for AI processes.
 * Extracted from CLITaskExecutor to keep the bridge as a thin facade.
 *
 * Idempotent: skips if the process already has a title.
 * Re-syncs the AI-generated title back to the task's displayName on every turn.
 */

import type { ConversationTurn, CopilotSDKService, ProcessStore, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory, isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';

export function generateTitleIfNeeded(
    processId: string,
    turns: ConversationTurn[],
    store: ProcessStore,
    aiService: CopilotSDKService,
    defaultWorkingDirectory: string | undefined,
    queueManager: TaskQueueManager | undefined,
): void {
    const logger = getLogger();
    const firstUserContent = (turns ?? []).find(t => t?.role === 'user')?.content ?? '';
    if (!firstUserContent) return;

    // Also grab the assistant's first response for context
    const firstAssistantContent = (turns ?? []).find(t => t?.role === 'assistant')?.content ?? '';

    void (async () => {
        try {
            const existing = await store.getProcess(processId);
            if (existing?.title) {
                // Re-sync the persisted AI title back to the task's displayName.
                // The enqueue follow-up path overwrites displayName with the follow-up message text,
                // so we restore it here on every turn to keep the two in sync.
                if (isQueueProcessId(processId) && queueManager) {
                    const taskId = toTaskId(processId);
                    queueManager.updateTask(taskId, { displayName: existing.title });
                }
                return;
            }

            const truncatedUser = firstUserContent.substring(0, 400);
            const truncatedAssistant = firstAssistantContent.substring(0, 400);

            let prompt: string;
            if (truncatedAssistant) {
                prompt = [
                    'Summarise the following conversation as a short title (max 8 words, no punctuation).',
                    'Focus on what was actually done or discussed, not on the instruction itself.',
                    '',
                    `User: "${truncatedUser}"`,
                    `Assistant: "${truncatedAssistant}"`,
                ].join('\n');
            } else {
                prompt = `Summarise the following user message as a short title (max 8 words, no punctuation):\n\n"${truncatedUser}"`;
            }

            const title: string = await (aiService as any).transform(
                prompt,
                (raw: string) => raw.trim().replace(/[".]/g, ''),
                { model: 'gpt-4.1', cwd: defaultWorkingDirectory },
            );
            if (title) {
                await store.updateProcess(processId, { title });
                if (isQueueProcessId(processId) && queueManager) {
                    const taskId = toTaskId(processId);
                    queueManager.updateTask(taskId, { displayName: title });
                }
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn(LogCategory.AI, `Title generation failed for ${processId}: ${errMsg}`);
        }
    })();
}
