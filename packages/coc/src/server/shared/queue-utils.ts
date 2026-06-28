/**
 * Shared queue utilities used across bridge classes.
 * Pure Node.js; uses only built-in modules.
 */

import type { TaskQueueManager, Attachment } from '@plusplusoneplusplus/forge';

/**
 * Truncate a display-name candidate to at most `max` characters.
 * If `text` exceeds `max`, returns the first `max - 3` chars followed by `...`.
 */
export function truncateDisplayName(text: string, max = 60): string {
    return text.length > max ? text.substring(0, max - 3) + '...' : text;
}

/**
 * Apply a follow-up prompt to an existing task and move it from history → queued.
 * Updates the task's display name, payload, and calls requeueFromHistory.
 * Throws if the task is not in history.
 *
 * @param manager - The TaskQueueManager that owns the task
 * @param taskId - ID of the task to requeue
 * @param prompt - Follow-up prompt text
 * @param attachments - Optional attachments for the follow-up
 * @param imageTempDir - Optional temp directory for image attachments
 * @param mode - Optional chat mode override
 * @param deliveryMode - Optional delivery mode override
 */
export function applyFollowUpToTask(
    manager: TaskQueueManager,
    taskId: string,
    prompt: string,
    attachments?: Attachment[],
    imageTempDir?: string,
    mode?: string,
    deliveryMode?: string,
    images?: string[],
    selectedSkillNames?: string[],
): void {
    const task = manager.getTask(taskId)!;
    const displayName = truncateDisplayName(prompt.trim());
    manager.updateTask(taskId, {
        displayName,
        payload: {
            ...task.payload,
            prompt,
            processId: task.processId,
            attachments,
            imageTempDir,
            ...(images ? { images } : {}),
            ...(mode ? { mode } : {}),
            ...(deliveryMode ? { deliveryMode } : {}),
            ...(selectedSkillNames && selectedSkillNames.length > 0
                ? { context: { ...(((task.payload as Record<string, unknown>).context as Record<string, unknown> | undefined) ?? {}), skills: selectedSkillNames } }
                : {}),
        },
    });
    if (!manager.requeueFromHistory(taskId)) {
        throw new Error(`Task ${taskId} is not available in history`);
    }
}
