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

const SCRIPT_TITLE_MAX_LEN = 60;

/**
 * Derive a short, human-readable title from a shell script without any AI call.
 *
 * Takes the first non-empty, non-comment line and truncates it to
 * SCRIPT_TITLE_MAX_LEN characters. Falls back to "Script" for empty/comment-only input.
 */
export function deriveScriptTitle(script: string): string {
    const lines = script.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            return trimmed.length > SCRIPT_TITLE_MAX_LEN
                ? trimmed.substring(0, SCRIPT_TITLE_MAX_LEN)
                : trimmed;
        }
    }
    return 'Script';
}

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

    // Require at least one assistant response before generating a title.
    // This avoids titles derived purely from the user prompt before any AI reply.
    const firstAssistantContent = (turns ?? []).find(t => t?.role === 'assistant')?.content ?? '';
    if (!firstAssistantContent) return;

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

            const prompt = [
                'Summarise the following conversation as a short title (max 8 words, no punctuation).',
                'Focus on what was actually done or discussed, not on the instruction itself.',
                '',
                `User: "${truncatedUser}"`,
                `Assistant: "${truncatedAssistant}"`,
            ].join('\n');

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
