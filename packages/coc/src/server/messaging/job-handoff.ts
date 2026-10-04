/**
 * Direct hand-offs from a WhatsApp/Teams sentinel thread.
 *
 * When a thread's target is a `sentinel` (dispatcher) chat, a mode prefix
 * (`/ask`, `/autopilot`, `/ralph`) does not go to the sentinel: CoC starts a
 * separate job in the sentinel's workspace with that mode and the message
 * body as its prompt, with no sentinel turn. The job records the thread as its
 * `messagingOrigin` and is tracked in the notice ledger, exactly like a job the
 * sentinel hands off with `send_to_conversation`, so it gets completion
 * notices, reply-to-notice routing and `ask_user` relay. A `/sentinel` prefix
 * or no prefix keeps the message on the sentinel.
 *
 * Both connector routers share this; each supplies its own origin and reply.
 */

import { isQueueProcessId, toQueueProcessId, toTaskId, type CreateTaskInput, type ProcessStore, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { MessagingChatMode } from '@plusplusoneplusplus/coc-connector';
import { normalizeChatMode } from '../tasks/task-types';
import type { MessagingJobNotices, MessagingJobOrigin } from './job-notices';

export type HandOffMode = Exclude<MessagingChatMode, 'sentinel'>;

export interface MessagingHandOffTarget {
    mode: HandOffMode;
    /** The sentinel's workspace; the job runs there. */
    workspaceId: string;
    /** The sentinel chat (persisted or still queued) the job is handed off from. */
    parentProcessId: string;
}

export interface MessagingHandOff {
    /** Set when a message to `targetProcessId` with `mode` hands off instead of continuing that chat. */
    resolve(targetProcessId: string | null | undefined, mode: MessagingChatMode | undefined): Promise<MessagingHandOffTarget | undefined>;
    /** Enqueue the job and track its notices; resolves the new job's process id. */
    start(target: MessagingHandOffTarget, prompt: string, origin: MessagingJobOrigin): Promise<string>;
}

export function createMessagingHandOff(deps: {
    store: Pick<ProcessStore, 'getProcess'>;
    queue: Pick<TaskQueueManager, 'getTask'>;
    enqueue: (input: CreateTaskInput) => Promise<string>;
    jobNotices: Pick<MessagingJobNotices, 'track'>;
}): MessagingHandOff {
    return {
        async resolve(targetProcessId, mode) {
            if (!targetProcessId || !mode || mode === 'sentinel') return undefined;
            const process = await deps.store.getProcess(targetProcessId);
            // A first turn still in the queue has no process yet; its task stands in.
            const task = !process && isQueueProcessId(targetProcessId) ? deps.queue.getTask(toTaskId(targetProcessId)) : undefined;
            const live = task && (task.status === 'queued' || task.status === 'running') ? task : undefined;
            const targetMode = normalizeChatMode(process ? process.metadata?.mode : (live?.payload as { mode?: unknown } | undefined)?.mode);
            const workspaceId = process ? process.metadata?.workspaceId : live?.repoId;
            if (targetMode !== 'sentinel' || typeof workspaceId !== 'string' || !workspaceId) return undefined;
            return { mode, workspaceId, parentProcessId: process?.id ?? targetProcessId };
        },
        async start({ mode, workspaceId, parentProcessId }, prompt, origin) {
            const taskId = await deps.enqueue({
                type: 'chat',
                repoId: workspaceId,
                priority: 'normal',
                payload: {
                    kind: 'chat', mode, prompt, workspaceId,
                    context: { spawnedFromProcessId: parentProcessId, messagingOrigin: origin },
                },
                config: {},
            });
            const processId = toQueueProcessId(taskId);
            try {
                deps.jobNotices.track({ processId, workspaceId, origin });
            } catch (error) {
                console.error('[messaging-handoff] Could not track the completion notice:', error);
            }
            return processId;
        },
    };
}
