/** A server-confirmed queued follow-up waiting for execution. */
export interface QueuedMessage {
    id: string;           // server-assigned UUID — used as React key and identifier
    content: string;
    status: 'queued' | 'steering';
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
            provider: task.provider,
            ...task.metadata,
            ...(processDetails?.metadata || {}),
        },
    };
}
