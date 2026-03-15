import type { DeliveryMode } from '@plusplusoneplusplus/pipeline-core';

/** A message waiting to be sent after the current AI turn completes. */
export interface QueuedMessage {
    id: string;           // crypto.randomUUID() — used as React key and bubble identifier
    content: string;
    deliveryMode: DeliveryMode;
    status: 'pending-send' | 'queued' | 'steering';
}

export function buildMetadataProcess(task: any, processDetails: any, processId: string | null): any {
    if (!task) return null;
    return {
        ...task,
        ...(processDetails || {}),
        id: processId ?? task.id,
        metadata: {
            queueTaskId: task.id,
            model: task.config?.model,
            mode: (task as any)?.payload?.mode,
            ...task.metadata,
            ...(processDetails?.metadata || {}),
        },
    };
}
