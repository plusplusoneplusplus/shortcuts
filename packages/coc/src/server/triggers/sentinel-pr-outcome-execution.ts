import type { PendingMessage, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { processOperationAdmission } from '../processes/process-operation-admission';
import type { ChatPayload } from '../tasks/task-types';
import type { SentinelPrOutcomeService } from './sentinel-pr-outcome-service';

/** Recheck trusted queued reviews before consuming their buffer or running an AI turn. */
export async function guardSentinelPrOutcomeExecution(
    store: ProcessStore,
    task: QueuedTask,
    service: Pick<SentinelPrOutcomeService, 'reviewExecutionDisposition'> | undefined,
): Promise<boolean> {
    const context = task.payload.context as Record<string, unknown> | undefined;
    if (context?.sentinelPrOutcomeReview !== true) return true;
    const processId = typeof task.payload.processId === 'string' ? task.payload.processId : task.processId;
    const workspaceId = task.payload.workspaceId;
    const triggerId = context.triggerId;
    const deliveryId = context.deliveryId;
    if (!processId || typeof workspaceId !== 'string' || context.source !== 'trigger'
        || typeof triggerId !== 'string' || typeof deliveryId !== 'string') return false;
    task.processId = processId;
    const disposition = service
        ? await service.reviewExecutionDisposition({ workspaceId, processId }, triggerId, deliveryId) : 'defer';
    if (disposition === 'execute') {
        delete task.payload.sentinelPrOutcomeExecutionDeferred;
        return true;
    }
    await processOperationAdmission.runExclusive(processId, async () => {
        const process = await store.getProcess(processId, workspaceId);
        if (!process) return;
        let pendingMessages = process.pendingMessages;
        if (disposition === 'defer') {
            const deferred = task.payload.deferredMessage as PendingMessage | undefined;
            const payload = task.payload as unknown as ChatPayload;
            const message: PendingMessage = {
                ...(deferred ?? {}),
                id: deferred?.id ?? deliveryId,
                relayRequestId: typeof task.payload.relayRequestId === 'string' ? task.payload.relayRequestId : deliveryId,
                content: typeof task.payload.prompt === 'string' ? task.payload.prompt : '',
                createdAt: deferred?.createdAt ?? new Date().toISOString(),
                mode: 'sentinel',
                provider: payload.provider,
                model: payload.model,
                attachments: payload.attachments,
                images: payload.images,
                context: { ...context, sentinelPrOutcomeDeferredTaskId: task.id },
            };
            task.payload.sentinelPrOutcomeExecutionDeferred = true;
            const pending = process.pendingMessages ?? [];
            pendingMessages = [...pending.filter(existing => existing.id !== message.id), message];
        } else {
            pendingMessages = process.pendingMessages?.filter(message => message.context?.deliveryId !== deliveryId);
        }
        await store.updateProcess(processId, {
            pendingMessages,
            ...(context.sentinelPrOutcomeStopped === true ? { status: 'cancelled' as const }
                : process.status === 'queued' ? { status: 'completed' as const } : {}),
        });
    });
    return false;
}
