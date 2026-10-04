/**
 * Chat mode for Teams/WhatsApp turns.
 *
 * The command parser leaves plain text without a mode. A follow-up then keeps
 * the chat's mode through `resolveFollowUpMode`; a new chat starts as the
 * `sentinel` dispatcher, whatever `sentinel.enabled` says (that flag only gates
 * the dashboard mode picker). Chats that already exist keep their own mode.
 * A first turn still waiting in the queue has no process yet, so its queued
 * mode stands in for the persisted one.
 */

import { isQueueProcessId, toTaskId, type ProcessStore, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { MessagingChatMode } from '@plusplusoneplusplus/coc-connector';
import { resolveFollowUpMode } from '../executors/follow-up-mode';
import type { ChatMode } from '../tasks/task-types';

/** `processId` undefined means a new chat. */
export type MessagingChatModeResolver = (processId: string | undefined, mode?: MessagingChatMode) => Promise<ChatMode>;

export function createMessagingChatModeResolver(
    store: ProcessStore,
    queue: Pick<TaskQueueManager, 'getTask'>,
): MessagingChatModeResolver {
    return async (processId, mode) => {
        if (!processId) return mode ?? 'sentinel';
        const queued = !mode && isQueueProcessId(processId) ? queue.getTask(toTaskId(processId)) : undefined;
        const queuedMode = queued?.status === 'queued' ? (queued.payload as { mode?: string }).mode : undefined;
        return resolveFollowUpMode(store, processId, mode ?? queuedMode);
    };
}
