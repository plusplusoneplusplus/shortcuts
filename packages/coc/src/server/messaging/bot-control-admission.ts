import { toQueueProcessId, type ProcessStore, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { BotControlSource } from '@plusplusoneplusplus/forge/ai';
import { processOperationAdmission } from '../processes/process-operation-admission';
import { createBotControlMetadata, validateBotControlMetadata } from './bot-control-metadata';

/** Trusted bridge admission for an existing conversation, not a public claim API. */
export async function admitBotControlledFollowUp<T>(
    store: Pick<ProcessStore, 'getProcess' | 'updateProcess'>,
    workspaceId: string,
    processId: string,
    source: BotControlSource,
    admit: (admissionHeld?: boolean) => Promise<T>,
): Promise<T> {
    return processOperationAdmission.runExclusive(processId, async () => {
        const process = await store.getProcess(processId, workspaceId);
        if (!process || process.metadata?.workspaceId !== workspaceId) {
            throw new Error('Bot-controlled conversation is unavailable in this workspace');
        }
        const prior = process.metadata.botControl;
        if (prior !== undefined) {
            // Admission compares ownership; the read boundary separately authorizes saved links.
            const control = validateBotControlMetadata({ ...prior, externalThreadUrl: undefined });
            if (control.source !== source) {
                throw new Error('Conversation is already controlled by another integration');
            }
            return admit(true);
        }

        const claimed = createBotControlMetadata(source);
        try {
            await store.updateProcess(processId, {
                metadata: { ...process.metadata, botControl: claimed },
            });
            return await admit(true);
        } catch (admissionError) {
            try {
                const current = await store.getProcess(processId, workspaceId);
                if (!current || current.id !== processId || current.metadata?.workspaceId !== workspaceId) {
                    throw new Error('Bot control admission rollback target changed');
                }
                const currentControl = current.metadata.botControl;
                if (currentControl !== undefined) {
                    const control = validateBotControlMetadata({ ...currentControl, externalThreadUrl: undefined });
                    if (control.source !== claimed.source || control.controllerKey !== claimed.controllerKey
                        || control.controllerLabel !== claimed.controllerLabel
                        || currentControl.externalThreadUrl !== claimed.externalThreadUrl) {
                        throw new Error('Bot control admission rollback target changed');
                    }
                    // A committed claim can fail at its observer before enqueue; compensate only that claim.
                    const metadata = { ...current.metadata };
                    delete metadata.botControl;
                    await store.updateProcess(processId, { metadata });
                }
            } catch (rollbackError) {
                throw Object.assign(
                    new Error('Bot control admission failed and could not be rolled back'),
                    { errors: [admissionError, rollbackError] },
                );
            }
            throw admissionError;
        }
    });
}

/** Binding owners must supply a failure-atomic removal, not a selection/transport change. */
export async function releaseBotControlledConversation(
    store: Pick<ProcessStore, 'getProcess' | 'updateProcess'>,
    queue: Pick<TaskQueueManager, 'getTask' | 'replaceBotControl'>,
    workspaceId: string,
    processId: string,
    source: BotControlSource,
    originTaskId: string | undefined,
    removeBinding: () => Promise<void>,
    prepareRemoval?: () => void,
): Promise<void> {
    await processOperationAdmission.runExclusive(processId, async () => {
        const process = await store.getProcess(processId, workspaceId);
        if (process && (process.id !== processId || process.metadata?.workspaceId !== workspaceId)) {
            throw new Error('Bot-controlled conversation is unavailable in this workspace');
        }
        const prior = process?.metadata?.botControl;
        const savedTaskId = process?.metadata?.queueTaskId;
        if (savedTaskId !== undefined && typeof savedTaskId !== 'string') {
            throw new Error('Bot control release queue authority is invalid');
        }
        // Forks retain source task provenance, not authority over the source's queued control.
        const forkSourceId = process?.metadata?.forkSourceId;
        const inheritedTaskId = savedTaskId !== undefined
            && typeof forkSourceId === 'string' && forkSourceId.length > 0 && forkSourceId !== processId
            && toQueueProcessId(savedTaskId) !== processId;
        const taskId = inheritedTaskId ? undefined : savedTaskId ?? originTaskId;
        const task = taskId ? queue.getTask(taskId) : undefined;
        if (task && (task.id !== taskId || task.type !== 'chat' || task.repoId !== workspaceId
            || (task.processId !== undefined && task.processId !== processId) || task.payload.kind !== 'chat'
            || task.payload.workspaceId !== workspaceId || toQueueProcessId(task.id) !== processId
            || (process ? savedTaskId !== task.id
                || (task.payload.processId !== undefined && task.payload.processId !== processId)
                : task.payload.processId !== undefined))) {
            throw new Error('Bot control release queue authority does not match the conversation');
        }
        const queuedControl = task?.botControl;
        for (const control of [prior, queuedControl]) {
            if (control !== undefined
                && validateBotControlMetadata({ ...control, externalThreadUrl: undefined }).source !== source) {
                throw new Error('Conversation is already controlled by another integration');
            }
        }
        prepareRemoval?.();

        let processWriteAttempted = false;
        let queueChanged = false;
        try {
            if (task && queuedControl !== undefined) {
                queue.replaceBotControl(task.id, queuedControl, undefined);
                queueChanged = true;
            }
            if (process?.metadata && prior !== undefined) {
                const metadata = { ...process.metadata };
                delete metadata.botControl;
                processWriteAttempted = true;
                await store.updateProcess(processId, { metadata });
            }
            await removeBinding();
        } catch (error) {
            const errors: unknown[] = [error];
            if (processWriteAttempted) {
                try {
                    const current = await store.getProcess(processId, workspaceId);
                    if (!current || current.metadata?.workspaceId !== workspaceId
                        || (current.metadata.botControl !== undefined
                            && current.metadata.botControl.source !== source)) {
                        throw new Error('Bot control release rollback target changed');
                    }
                    if (current.metadata.botControl === undefined) {
                        await store.updateProcess(processId, { metadata: { ...current.metadata, botControl: prior } });
                    } else {
                        const existing = validateBotControlMetadata({ ...current.metadata.botControl, externalThreadUrl: undefined });
                        if (existing.controllerKey !== prior?.controllerKey
                            || existing.controllerLabel !== prior?.controllerLabel
                            || current.metadata.botControl.externalThreadUrl !== prior?.externalThreadUrl) {
                            throw new Error('Bot control release rollback target changed');
                        }
                    }
                } catch (rollbackError) {
                    errors.push(rollbackError);
                }
            }
            if (queueChanged && task) {
                try {
                    queue.replaceBotControl(task.id, undefined, queuedControl);
                } catch (rollbackError) {
                    errors.push(rollbackError);
                }
            }
            if (errors.length > 1) {
                throw Object.assign(new Error('Bot control release failed and could not be fully rolled back'), { errors });
            }
            throw error;
        }
    });
}
