import { isQueueProcessId, toQueueProcessId, toTaskId, type AIProcessStatus, type ProcessStore } from '@plusplusoneplusplus/forge';
import type { QueueExecutorBridge } from '../core/api-handler';
import { APIError, badRequest, notFound } from '../errors';
import { processOperationAdmission } from './process-operation-admission';

const TERMINAL_STATUSES = new Set<AIProcessStatus>(['completed', 'failed', 'cancelled']);
const CANCEL_TIMEOUT_MS = 30_000;

export interface ConversationCancellationResult {
    processId: string;
    workspaceId?: string;
    cancelled: boolean;
    status: AIProcessStatus;
}

/** Shared stop lifecycle for REST and tools; never removes history or appends a turn. */
export async function cancelConversation(
    store: ProcessStore,
    bridge: QueueExecutorBridge | undefined,
    processId: string,
    workspaceId?: string,
): Promise<ConversationCancellationResult> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(processId) || processId === 'queue_') {
        throw badRequest('Invalid local conversation processId.');
    }
    if (workspaceId !== undefined && (!workspaceId.trim() || workspaceId.startsWith('remote:') || workspaceId.includes('@'))) {
        throw badRequest('Cancel requires an exact local workspace ID, not a remote route.');
    }
    let existing = await store.getProcess(processId);
    if (!existing && isQueueProcessId(processId)) existing = await store.getProcess(toTaskId(processId));
    const taskId = isQueueProcessId(processId) ? toTaskId(processId) : processId;
    const queueTaskId = existing && !isQueueProcessId(existing.id) ? undefined : taskId;
    const task = queueTaskId === undefined ? undefined : bridge?.getTask?.(queueTaskId);
    // A follow-up task's identity must not alias the conversation it targets.
    const taskProcessId = task?.processId ?? task?.payload.processId;
    if (!existing && taskProcessId && taskProcessId !== toQueueProcessId(taskId)) {
        throw badRequest('Use the conversation processId, not a follow-up task ID.');
    }
    const canonicalId = existing?.id ?? toQueueProcessId(taskId);
    return processOperationAdmission.runExclusive(canonicalId, async () => {
        const current = await store.getProcess(canonicalId);
        const queuedTask = queueTaskId === undefined ? undefined : bridge?.getTask?.(queueTaskId);
        if (!current && !queuedTask) throw notFound('Conversation');
        const owner = current?.metadata?.workspaceId ?? queuedTask?.repoId;
        if (workspaceId !== undefined && owner !== workspaceId) throw notFound('Conversation');
        const status = current?.status ?? queuedTask!.status;
        const result = { processId: canonicalId, ...(owner ? { workspaceId: owner } : {}) };
        // A terminal process can still have an admitted follow-up waiting in its queue.
        const activeTask = bridge?.findTaskByProcessId?.(canonicalId);
        const hasPendingWork = queuedTask?.status === 'queued' || queuedTask?.status === 'running'
            || activeTask?.status === 'queued' || activeTask?.status === 'running'
            || !!current?.pendingMessages?.length;
        if (TERMINAL_STATUSES.has(status) && !hasPendingWork) {
            return { ...result, cancelled: false, status };
        }
        const compaction = bridge?.findCompactionTask?.(canonicalId);
        const runningTask = activeTask?.status === 'running' ? bridge?.getTask?.(activeTask.id) : undefined;
        if (compaction?.status === 'running'
            || (queuedTask?.status === 'running' && queuedTask.config.cancelRunning === false)
            || runningTask?.config.cancelRunning === false) {
            throw new APIError(409, 'This running operation cannot be cancelled.', 'CONFLICT');
        }
        if (!bridge?.cancelProcess) {
            throw new APIError(503, 'Conversation cancellation is not available.', 'CANCEL_UNAVAILABLE');
        }
        if (current && !TERMINAL_STATUSES.has(current.status)) {
            await store.updateProcess(canonicalId, { status: 'cancelling' });
        }
        process.stderr.write(`[Process] cancel id=${canonicalId} prevStatus=${status}\n`);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                bridge.cancelProcess(canonicalId),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new APIError(504, 'Conversation cancellation timed out.', 'CANCEL_TIMEOUT')), CANCEL_TIMEOUT_MS);
                }),
            ]);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
        const updated = await store.getProcess(canonicalId);
        for (const message of updated?.pendingMessages ?? []) {
            await store.removePendingMessage(canonicalId, message.id);
        }
        if (updated && !TERMINAL_STATUSES.has(updated.status)) {
            await store.updateProcess(canonicalId, { status: 'cancelled', endTime: new Date() });
        }
        const finalProcess = await store.getProcess(canonicalId);
        const finalTask = queueTaskId === undefined ? undefined : bridge.getTask?.(queueTaskId);
        const remainingTask = bridge.findTaskByProcessId?.(canonicalId);
        if ((!finalProcess && finalTask?.status !== 'cancelled')
            || (finalProcess && !TERMINAL_STATUSES.has(finalProcess.status))
            || remainingTask?.status === 'queued' || remainingTask?.status === 'running') {
            throw new APIError(500, 'Conversation task was not cancelled.', 'CANCEL_FAILED');
        }
        return { ...result, cancelled: true, status: finalProcess?.status ?? 'cancelled' };
    });
}
